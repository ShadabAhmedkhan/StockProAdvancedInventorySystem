import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { getCurrentOrgId } from '../common/tenant/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import { StockService, type StockSummary } from '../stock/stock.service';
import type { SalesReportQueryDto, SalesReportPeriod } from './dto/sales-report-query.dto';
import type { TopProductsQueryDto } from './dto/top-products-query.dto';
import { buildCompletedOrderWhere, type CategoryValuationRow, type SalesReportRow, type TopProductRow } from './reports-views';

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
}
