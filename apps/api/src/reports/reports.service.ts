import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { getCurrentOrgId } from '../common/tenant/tenant-context';
import { FinanceService, type FinanceSummary } from '../finance/finance.service';
import { OPEN_REPAIR_STATUSES, PAYABLE_REPAIR_STATUSES } from '../repairs/repair-status';
import { PrismaService } from '../prisma/prisma.service';
import { StockService, type StockSummary } from '../stock/stock.service';
import type { AnalyticsQueryDto } from './dto/analytics-query.dto';
import type { SalesReportQueryDto, SalesReportPeriod } from './dto/sales-report-query.dto';
import type { TopProductsQueryDto } from './dto/top-products-query.dto';
import {
  buildCompletedOrderWhere,
  dateRangeCondition,
  type AgingBucketRow,
  type CategoryValuationRow,
  type LocationValuationRow,
  type RepairTurnaroundRow,
  type SalesAnalyticsRow,
  type SalesReportRow,
  type SupplierPerformanceRow,
  type TechnicianWorkloadRow,
  type TopProductRow,
} from './reports-views';

const ZERO = new Prisma.Decimal(0);

export interface SalesReportPoint {
  period: string;
  orders: number;
  subtotal: Prisma.Decimal;
  discount: Prisma.Decimal;
  tax: Prisma.Decimal;
  total: Prisma.Decimal;
}

export interface SalesReport {
  from: Date | null;
  to: Date | null;
  groupBy: SalesReportPeriod;
  points: SalesReportPoint[];
  totals: { orders: number; subtotal: Prisma.Decimal; discount: Prisma.Decimal; tax: Prisma.Decimal; total: Prisma.Decimal };
}

export interface InventoryReport {
  categories: CategoryValuationRow[];
  totals: StockSummary;
}

export interface TopProduct {
  productId: string;
  sku: string;
  name: string;
  quantitySold: number;
  revenue: Prisma.Decimal;
}

export interface SalesAnalytics {
  from: Date | null;
  to: Date | null;
  orderCount: number;
  revenue: Prisma.Decimal;
  /** Revenue minus the current cost of the units sold - an approximation, since a sale's line does not
   * freeze the unit cost at sale time the way it freezes `unitPrice`; a later cost change reprices past sales. */
  grossProfit: Prisma.Decimal;
  /** grossProfit / revenue, 0 when there is no revenue. */
  margin: Prisma.Decimal;
  averageOrderValue: Prisma.Decimal;
  /** discount / subtotal, 0 when there is no subtotal. */
  discountRate: Prisma.Decimal;
  /** Completed returns in the window / completed orders in the window. */
  returnRate: Prisma.Decimal;
}

export interface InventoryAnalytics {
  categories: CategoryValuationRow[];
  byLocation: LocationValuationRow[];
  totals: StockSummary;
  /** COGS for the window over the catalogue's current cost value - how many times stock "turned over". Null with no stock on hand. */
  stockTurnover: Prisma.Decimal | null;
  /** In stock, but with no SALE movement in `deadStockDays`. */
  deadStockCount: number;
  /** Every in-stock product bucketed by days since its last stock movement. */
  aging: AgingBucketRow[];
}

export interface PurchasingAnalytics {
  from: Date | null;
  to: Date | null;
  suppliers: SupplierPerformanceRow[];
}

export interface RepairsAnalytics {
  from: Date | null;
  to: Date | null;
  /** Repairs received in the window that reached COMPLETED/DELIVERED, over every repair received in it. */
  completionRate: Prisma.Decimal;
  avgTurnaroundDays: number | null;
  repairRevenue: Prisma.Decimal;
  /** Current open workload per technician, not windowed - a snapshot of who is carrying what right now. */
  technicianWorkload: TechnicianWorkloadRow[];
}

export interface AdvancedAnalytics {
  sales: SalesAnalytics;
  inventory: InventoryAnalytics;
  purchasing: PurchasingAnalytics;
  repairs: RepairsAnalytics;
  finance: FinanceSummary;
}

/**
 * Reports break a figure the dashboard already shows down further - by
 * period, by category, by product - rather than introducing new totals to
 * keep in sync with it. Every query here does its grouping in the database:
 * a report answered by fetching every order and folding it in JavaScript
 * would not survive a real order history.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
    private readonly financeService: FinanceService,
  ) {}

  async salesReport(query: SalesReportQueryDto): Promise<SalesReport> {
    const where = buildCompletedOrderWhere(query.from, query.to);

    const rows = await this.prisma.$queryRaw<SalesReportRow[]>`
      SELECT
        date_trunc(${query.groupBy}, o."completedAt")::date              AS "period",
        COUNT(*)::int                                                   AS "orders",
        COALESCE(SUM(o."subtotal"), 0)::numeric(14, 2)                  AS "subtotal",
        COALESCE(SUM(o."discount"), 0)::numeric(14, 2)                  AS "discount",
        COALESCE(SUM(o."tax"), 0)::numeric(14, 2)                       AS "tax",
        COALESCE(SUM(o."total"), 0)::numeric(14, 2)                     AS "total"
      FROM "Order" o
      WHERE ${where}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const points = rows.map((row) => ({ ...row, period: row.period.toISOString().slice(0, 10) }));

    const totals = points.reduce(
      (sum, point) => ({
        orders: sum.orders + point.orders,
        subtotal: sum.subtotal.add(point.subtotal),
        discount: sum.discount.add(point.discount),
        tax: sum.tax.add(point.tax),
        total: sum.total.add(point.total),
      }),
      { orders: 0, subtotal: ZERO, discount: ZERO, tax: ZERO, total: ZERO },
    );

    return { from: query.from ?? null, to: query.to ?? null, groupBy: query.groupBy, points, totals };
  }

  /** The stock summary broken down by category, rather than one figure for the whole catalogue. */
  async inventoryReport(): Promise<InventoryReport> {
    const [categories, totals] = await Promise.all([
      this.prisma.$queryRaw<CategoryValuationRow[]>`
        SELECT
          c."id"                                                                          AS "categoryId",
          c."name"                                                                        AS "categoryName",
          COUNT(*)::int                                                                   AS "productCount",
          COALESCE(SUM(i."quantity"), 0)::int                                             AS "totalUnits",
          COALESCE(SUM(i."quantity" * p."costPrice"), 0)::numeric(14, 2)                  AS "valueAtCost",
          COALESCE(SUM(i."quantity" * p."sellingPrice"), 0)::numeric(14, 2)               AS "valueAtRetail",
          COUNT(*) FILTER (WHERE i."quantity" > 0 AND i."quantity" <= p."minimumStock")::int AS "lowStockCount",
          COUNT(*) FILTER (WHERE i."quantity" = 0)::int                                   AS "outOfStockCount"
        FROM "Inventory" i
        JOIN "Product" p ON p."id" = i."productId"
        JOIN "Category" c ON c."id" = p."categoryId"
        WHERE i."organizationId" = ${getCurrentOrgId()}::uuid AND p."deletedAt" IS NULL
        GROUP BY c."id", c."name"
        ORDER BY "valueAtRetail" DESC
      `,
      this.stockService.summary(),
    ]);

    return { categories, totals };
  }

  async topProducts(query: TopProductsQueryDto): Promise<TopProduct[]> {
    const where = buildCompletedOrderWhere(query.from, query.to);

    return this.prisma.$queryRaw<TopProductRow[]>`
      SELECT
        p."id"                                AS "productId",
        p."sku",
        p."name",
        SUM(oi."quantity")::int                AS "quantitySold",
        COALESCE(SUM(oi."total"), 0)::numeric(14, 2) AS "revenue"
      FROM "OrderItem" oi
      JOIN "Order" o ON o."id" = oi."orderId"
      JOIN "Product" p ON p."id" = oi."productId"
      WHERE ${where}
      GROUP BY p."id", p."sku", p."name"
      ORDER BY "revenue" DESC
      LIMIT ${query.limit}
    `;
  }

  /**
   * Phase 40: the wider set of figures a shop wants beyond the dashboard's
   * at-a-glance view and the time-series/top-products reports above - one
   * request per section of the analytics page, run in parallel, each reusing
   * an existing where-builder or module (`FinanceService.summary()`) rather
   * than re-deriving a figure another page already owns.
   */
  async advancedAnalytics(query: AnalyticsQueryDto): Promise<AdvancedAnalytics> {
    const organizationId = getCurrentOrgId();
    const orderWhere = buildCompletedOrderWhere(query.from, query.to);
    const returnDateCondition = dateRangeCondition(Prisma.sql`r."completedAt"`, query.from, query.to);
    const poDateCondition = dateRangeCondition(Prisma.sql`po."createdAt"`, query.from, query.to);
    const repairDateCondition = dateRangeCondition(Prisma.sql`r."receivedAt"`, query.from, query.to);
    const openStatuses = Prisma.join(OPEN_REPAIR_STATUSES.map((status) => Prisma.sql`${status}::"RepairStatus"`));
    const payableStatuses = Prisma.join(PAYABLE_REPAIR_STATUSES.map((status) => Prisma.sql`${status}::"RepairStatus"`));

    const [salesRows, returnCountRows, categories, byLocation, agingRows, deadStockRows, stockSummary, supplierRows, repairRows, technicianRows, finance] =
      await Promise.all([
        this.prisma.$queryRaw<SalesAnalyticsRow[]>`
          WITH orders AS (SELECT * FROM "Order" o WHERE ${orderWhere})
          SELECT
            (SELECT COUNT(*) FROM orders)::int AS "orderCount",
            (SELECT COALESCE(SUM("total"), 0) FROM orders)::numeric(14, 2) AS "revenue",
            (SELECT COALESCE(SUM("subtotal"), 0) FROM orders)::numeric(14, 2) AS "subtotal",
            (SELECT COALESCE(SUM("discount"), 0) FROM orders)::numeric(14, 2) AS "discount",
            COALESCE(
              (SELECT SUM(oi."quantity" * p."costPrice") FROM "OrderItem" oi JOIN orders o2 ON o2."id" = oi."orderId" JOIN "Product" p ON p."id" = oi."productId"),
              0
            )::numeric(14, 2) AS "cogs"
        `,
        this.prisma.$queryRaw<{ count: number }[]>`
          SELECT COUNT(*)::int AS count FROM "Return" r
          WHERE r."organizationId" = ${organizationId}::uuid AND r."status" = 'COMPLETED'::"ReturnStatus" AND ${returnDateCondition}
        `,
        this.prisma.$queryRaw<CategoryValuationRow[]>`
          SELECT
            c."id" AS "categoryId",
            c."name" AS "categoryName",
            COUNT(*)::int AS "productCount",
            COALESCE(SUM(i."quantity"), 0)::int AS "totalUnits",
            COALESCE(SUM(i."quantity" * p."costPrice"), 0)::numeric(14, 2) AS "valueAtCost",
            COALESCE(SUM(i."quantity" * p."sellingPrice"), 0)::numeric(14, 2) AS "valueAtRetail",
            COUNT(*) FILTER (WHERE i."quantity" > 0 AND i."quantity" <= p."minimumStock")::int AS "lowStockCount",
            COUNT(*) FILTER (WHERE i."quantity" = 0)::int AS "outOfStockCount"
          FROM "Inventory" i
          JOIN "Product" p ON p."id" = i."productId"
          JOIN "Category" c ON c."id" = p."categoryId"
          WHERE i."organizationId" = ${organizationId}::uuid AND p."deletedAt" IS NULL
          GROUP BY c."id", c."name"
          ORDER BY "valueAtRetail" DESC
        `,
        this.prisma.$queryRaw<LocationValuationRow[]>`
          SELECT
            l."id" AS "locationId",
            l."name" AS "locationName",
            COALESCE(SUM(i."quantity"), 0)::int AS "totalUnits",
            COALESCE(SUM(i."quantity" * p."costPrice"), 0)::numeric(14, 2) AS "valueAtCost",
            COALESCE(SUM(i."quantity" * p."sellingPrice"), 0)::numeric(14, 2) AS "valueAtRetail"
          FROM "Inventory" i
          JOIN "Product" p ON p."id" = i."productId"
          JOIN "Location" l ON l."id" = i."locationId"
          WHERE i."organizationId" = ${organizationId}::uuid AND p."deletedAt" IS NULL
          GROUP BY l."id", l."name"
          ORDER BY "valueAtRetail" DESC
        `,
        this.prisma.$queryRaw<AgingBucketRow[]>`
          WITH last_movement AS (
            SELECT DISTINCT ON (sm."productId") sm."productId", sm."createdAt"
            FROM "StockMovement" sm
            WHERE sm."organizationId" = ${organizationId}::uuid
            ORDER BY sm."productId", sm."createdAt" DESC
          )
          SELECT
            CASE
              WHEN lm."createdAt" IS NULL THEN 'never moved'
              WHEN NOW() - lm."createdAt" <= INTERVAL '30 days' THEN '0-30'
              WHEN NOW() - lm."createdAt" <= INTERVAL '60 days' THEN '31-60'
              WHEN NOW() - lm."createdAt" <= INTERVAL '90 days' THEN '61-90'
              ELSE '90+'
            END AS "bucket",
            COUNT(*)::int AS "productCount"
          FROM "Inventory" i
          JOIN "Product" p ON p."id" = i."productId"
          LEFT JOIN last_movement lm ON lm."productId" = i."productId"
          WHERE i."organizationId" = ${organizationId}::uuid AND p."deletedAt" IS NULL AND i."quantity" > 0
          GROUP BY 1
        `,
        this.prisma.$queryRaw<{ count: number }[]>`
          WITH last_sale AS (
            SELECT sm."productId", MAX(sm."createdAt") AS "lastSaleAt"
            FROM "StockMovement" sm
            WHERE sm."organizationId" = ${organizationId}::uuid AND sm."type" = 'SALE'::"StockMovementType"
            GROUP BY sm."productId"
          )
          SELECT COUNT(*)::int AS count
          FROM "Inventory" i
          JOIN "Product" p ON p."id" = i."productId"
          LEFT JOIN last_sale ls ON ls."productId" = i."productId"
          WHERE i."organizationId" = ${organizationId}::uuid AND p."deletedAt" IS NULL AND i."quantity" > 0
            AND (ls."lastSaleAt" IS NULL OR ls."lastSaleAt" < NOW() - make_interval(days => ${query.deadStockDays}))
        `,
        this.stockService.summary(),
        this.prisma.$queryRaw<SupplierPerformanceRow[]>`
          WITH pos AS (
            SELECT * FROM "PurchaseOrder" po WHERE po."organizationId" = ${organizationId}::uuid AND ${poDateCondition}
          ),
          receipts AS (
            SELECT gr."purchaseOrderId", MAX(gr."createdAt") AS "lastReceiptAt"
            FROM "GoodsReceipt" gr
            JOIN pos ON pos."id" = gr."purchaseOrderId"
            GROUP BY gr."purchaseOrderId"
          )
          SELECT
            s."id" AS "supplierId",
            s."name" AS "supplierName",
            COUNT(pos."id")::int AS "orderCount",
            COALESCE(SUM(pos."total"), 0)::numeric(14, 2) AS "totalSpend",
            AVG(EXTRACT(EPOCH FROM (r."lastReceiptAt" - pos."createdAt")) / 86400) FILTER (WHERE pos."status" = 'RECEIVED'::"PurchaseOrderStatus")::float8 AS "avgLeadTimeDays",
            (
              COUNT(*) FILTER (WHERE pos."status" = 'RECEIVED'::"PurchaseOrderStatus" AND pos."expectedDate" IS NOT NULL AND r."lastReceiptAt" <= pos."expectedDate")::numeric
              / NULLIF(COUNT(*) FILTER (WHERE pos."status" = 'RECEIVED'::"PurchaseOrderStatus" AND pos."expectedDate" IS NOT NULL), 0)
            ) AS "onTimeRate"
          FROM pos
          JOIN "Supplier" s ON s."id" = pos."supplierId"
          LEFT JOIN receipts r ON r."purchaseOrderId" = pos."id"
          GROUP BY s."id", s."name"
          ORDER BY "totalSpend" DESC
        `,
        this.prisma.$queryRaw<RepairTurnaroundRow[]>`
          WITH received AS (
            SELECT * FROM "Repair" r WHERE r."organizationId" = ${organizationId}::uuid AND ${repairDateCondition}
          )
          SELECT
            COUNT(*)::int AS "totalCount",
            COUNT(*) FILTER (WHERE "status" IN (${payableStatuses}))::int AS "completedCount",
            AVG(EXTRACT(EPOCH FROM ("completedAt" - "receivedAt")) / 86400) FILTER (WHERE "status" IN (${payableStatuses}) AND "completedAt" IS NOT NULL)::float8 AS "avgTurnaroundDays",
            COALESCE(SUM("finalCost") FILTER (WHERE "status" IN (${payableStatuses})), 0)::numeric(14, 2) AS "repairRevenue"
          FROM received
        `,
        this.prisma.$queryRaw<TechnicianWorkloadRow[]>`
          SELECT
            u."id" AS "technicianId",
            (u."firstName" || ' ' || u."lastName") AS "technicianName",
            COUNT(r."id") FILTER (WHERE r."status" IN (${openStatuses}))::int AS "activeCount"
          FROM "User" u
          LEFT JOIN "Repair" r ON r."technicianId" = u."id"
          WHERE u."organizationId" = ${organizationId}::uuid AND u."role" = 'TECHNICIAN'::"UserRole"
          GROUP BY u."id", u."firstName", u."lastName"
          ORDER BY "activeCount" DESC
        `,
        this.financeService.summary({ from: query.from, to: query.to }),
      ]);

    const sales = salesRows[0] ?? { orderCount: 0, revenue: ZERO, subtotal: ZERO, discount: ZERO, cogs: ZERO };
    const grossProfit = sales.revenue.sub(sales.cogs);
    const returnCount = returnCountRows[0]?.count ?? 0;
    const repairs = repairRows[0] ?? { totalCount: 0, completedCount: 0, avgTurnaroundDays: null, repairRevenue: ZERO };
    const deadStockCount = deadStockRows[0]?.count ?? 0;

    return {
      sales: {
        from: query.from ?? null,
        to: query.to ?? null,
        orderCount: sales.orderCount,
        revenue: sales.revenue,
        grossProfit,
        margin: sales.revenue.eq(ZERO) ? ZERO : grossProfit.div(sales.revenue),
        averageOrderValue: sales.orderCount === 0 ? ZERO : sales.revenue.div(sales.orderCount),
        discountRate: sales.subtotal.eq(ZERO) ? ZERO : sales.discount.div(sales.subtotal),
        returnRate: sales.orderCount === 0 ? ZERO : new Prisma.Decimal(returnCount).div(sales.orderCount),
      },
      inventory: {
        categories,
        byLocation,
        totals: stockSummary,
        stockTurnover: stockSummary.inventoryValueAtCost === '0.00' ? null : sales.cogs.div(stockSummary.inventoryValueAtCost),
        deadStockCount,
        aging: agingRows,
      },
      purchasing: { from: query.from ?? null, to: query.to ?? null, suppliers: supplierRows },
      repairs: {
        from: query.from ?? null,
        to: query.to ?? null,
        completionRate: repairs.totalCount === 0 ? ZERO : new Prisma.Decimal(repairs.completedCount).div(repairs.totalCount),
        avgTurnaroundDays: repairs.avgTurnaroundDays,
        repairRevenue: repairs.repairRevenue,
        technicianWorkload: technicianRows,
      },
      finance,
    };
  }
}
