import { searchAcross } from '../common/pagination/search.util';
import type { Prisma } from '../generated/prisma/client';
import type { PurchaseOrderQueryDto } from './dto/purchase-order-query.dto';

/**
 * How purchase orders are read: what a list row carries, what a single order
 * carries, and how a query narrows the set. Kept apart from the workflow, the
 * same split as `order-views.ts`.
 */

export const PURCHASE_ORDER_SUMMARY_INCLUDE = {
  supplier: { select: { id: true, supplierCode: true, name: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { items: true } },
} as const;

export const PURCHASE_ORDER_DETAIL_INCLUDE = {
  supplier: { select: { id: true, supplierCode: true, name: true, phone: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  items: { include: { product: { select: { id: true, sku: true, name: true } } }, orderBy: { createdAt: 'asc' } },
} as const;

export type PurchaseOrderSummary = Prisma.PurchaseOrderGetPayload<{ include: typeof PURCHASE_ORDER_SUMMARY_INCLUDE }>;
export type PurchaseOrderDetail = Prisma.PurchaseOrderGetPayload<{ include: typeof PURCHASE_ORDER_DETAIL_INCLUDE }>;

/**
 * Columns a free-text search looks at. Module-owned, never caller-supplied.
 *
 * A supplier is found by its own filter rather than by name here, for the
 * same reason as `order-views.ts`: reaching across the relation would turn
 * every search into a join over the whole supplier table.
 */
const SEARCHABLE_FIELDS = ['poNumber', 'notes'] as const;

export function buildPurchaseOrderWhere(query: PurchaseOrderQueryDto): Prisma.PurchaseOrderWhereInput {
  const filters: Prisma.PurchaseOrderWhereInput = {
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.supplierId === undefined ? {} : { supplierId: query.supplierId }),
    ...(query.createdFrom === undefined && query.createdTo === undefined
      ? {}
      : {
          createdAt: {
            ...(query.createdFrom === undefined ? {} : { gte: query.createdFrom }),
            ...(query.createdTo === undefined ? {} : { lte: query.createdTo }),
          },
        }),
  };

  const search = searchAcross<Prisma.PurchaseOrderWhereInput>(query.search, SEARCHABLE_FIELDS);

  return search === undefined ? filters : { ...filters, ...search };
}
