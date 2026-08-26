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
