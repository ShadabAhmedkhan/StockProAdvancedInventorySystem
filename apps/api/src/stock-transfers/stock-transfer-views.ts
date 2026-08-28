import { searchAcross } from '../common/pagination/search.util';
import type { Prisma } from '../generated/prisma/client';
import type { StockTransferQueryDto } from './dto/stock-transfer-query.dto';

/**
 * How stock transfers are read: what a list row carries, what a single
 * transfer carries, and how a query narrows the set. Kept apart from the
 * workflow, the same split as `purchase-order-views.ts`.
 */

export const STOCK_TRANSFER_SUMMARY_INCLUDE = {
  sourceLocation: { select: { id: true, name: true } },
  destinationLocation: { select: { id: true, name: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { items: true } },
} as const;

export const STOCK_TRANSFER_DETAIL_INCLUDE = {
  sourceLocation: { select: { id: true, name: true } },
  destinationLocation: { select: { id: true, name: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  items: { include: { product: { select: { id: true, sku: true, name: true } } }, orderBy: { createdAt: 'asc' } },
} as const;

export type StockTransferSummary = Prisma.StockTransferGetPayload<{ include: typeof STOCK_TRANSFER_SUMMARY_INCLUDE }>;
export type StockTransferDetail = Prisma.StockTransferGetPayload<{ include: typeof STOCK_TRANSFER_DETAIL_INCLUDE }>;

/** Columns a free-text search looks at. Module-owned, never caller-supplied. */
const SEARCHABLE_FIELDS = ['transferNumber', 'notes'] as const;

export function buildStockTransferWhere(query: StockTransferQueryDto): Prisma.StockTransferWhereInput {
  const filters: Prisma.StockTransferWhereInput = {
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.sourceLocationId === undefined ? {} : { sourceLocationId: query.sourceLocationId }),
    ...(query.destinationLocationId === undefined ? {} : { destinationLocationId: query.destinationLocationId }),
  };

  const search = searchAcross<Prisma.StockTransferWhereInput>(query.search, SEARCHABLE_FIELDS);

  return search === undefined ? filters : { ...filters, ...search };
}
