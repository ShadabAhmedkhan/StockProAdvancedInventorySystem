import { Prisma } from '../generated/prisma/client';
import { getCurrentOrgId } from '../common/tenant/tenant-context';

/**
 * `completedAt` is what revenue reporting keys off, not `createdAt` - a draft
 * raised last month and only completed today belongs to today's figures.
 * Shared by the sales report and the top-products report, which both start
 * from the same "completed, optionally within a window" set of orders.
 *
 * Raw `$queryRaw` bypasses the tenant Prisma extension entirely, so the org
 * filter is included by hand here rather than relied on from the caller.
 */
export function buildCompletedOrderWhere(from: Date | undefined, to: Date | undefined): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`o."organizationId" = ${getCurrentOrgId()}::uuid`, Prisma.sql`o."status" = 'COMPLETED'::"OrderStatus"`];

  if (from !== undefined) {
    conditions.push(Prisma.sql`o."completedAt" >= ${from}`);
  }
  if (to !== undefined) {
    conditions.push(Prisma.sql`o."completedAt" <= ${to}`);
  }

  return Prisma.join(conditions, ' AND ');
}

export interface SalesReportRow {
  period: Date;
  orders: number;
  subtotal: Prisma.Decimal;
  discount: Prisma.Decimal;
  tax: Prisma.Decimal;
  total: Prisma.Decimal;
}

export interface CategoryValuationRow {
  categoryId: string;
  categoryName: string;
  productCount: number;
  totalUnits: number;
  valueAtCost: Prisma.Decimal;
  valueAtRetail: Prisma.Decimal;
  lowStockCount: number;
  outOfStockCount: number;
}

export interface TopProductRow {
  productId: string;
  sku: string;
  name: string;
  quantitySold: number;
  revenue: Prisma.Decimal;
}

/** Same shape as {@link buildCompletedOrderWhere} but for `PurchaseOrder`/`Repair`, whose date column varies by module. */
export function dateRangeCondition(column: Prisma.Sql, from: Date | undefined, to: Date | undefined): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];

  if (from !== undefined) {
    conditions.push(Prisma.sql`${column} >= ${from}`);
  }
  if (to !== undefined) {
    conditions.push(Prisma.sql`${column} <= ${to}`);
  }

  return conditions.length === 0 ? Prisma.sql`TRUE` : Prisma.join(conditions, ' AND ');
}

export interface SalesAnalyticsRow {
  orderCount: number;
  revenue: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  discount: Prisma.Decimal;
  cogs: Prisma.Decimal;
}

export interface LocationValuationRow {
  locationId: string;
  locationName: string;
  totalUnits: number;
  valueAtCost: Prisma.Decimal;
  valueAtRetail: Prisma.Decimal;
}

export interface AgingBucketRow {
  bucket: '0-30' | '31-60' | '61-90' | '90+' | 'never moved';
  productCount: number;
}

export interface SupplierPerformanceRow {
  supplierId: string;
  supplierName: string;
  orderCount: number;
  totalSpend: Prisma.Decimal;
  avgLeadTimeDays: number | null;
  onTimeRate: Prisma.Decimal | null;
}

export interface RepairTurnaroundRow {
  totalCount: number;
  completedCount: number;
  avgTurnaroundDays: number | null;
  repairRevenue: Prisma.Decimal;
}

export interface TechnicianWorkloadRow {
  technicianId: string;
  technicianName: string;
  activeCount: number;
}
