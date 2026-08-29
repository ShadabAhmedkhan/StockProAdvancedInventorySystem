import { searchAcross } from '../common/pagination/search.util';
import type { Prisma } from '../generated/prisma/client';
import type { StockCountQueryDto } from './dto/stock-count-query.dto';

/**
 * How stock counts are read: what a list row carries, what a single count
 * carries, and how a query narrows the set. Kept apart from the workflow, the
 * same split as `purchase-order-views.ts`.
 */

export const STOCK_COUNT_SUMMARY_INCLUDE = {
  location: { select: { id: true, name: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { items: true } },
} as const;

export const STOCK_COUNT_DETAIL_INCLUDE = {
  location: { select: { id: true, name: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
  items: { include: { product: { select: { id: true, sku: true, name: true } } }, orderBy: { createdAt: 'asc' } },
} as const;

export type StockCountSummary = Prisma.StockCountGetPayload<{ include: typeof STOCK_COUNT_SUMMARY_INCLUDE }>;
export type StockCountDetail = Prisma.StockCountGetPayload<{ include: typeof STOCK_COUNT_DETAIL_INCLUDE }>;

/** Same as {@link StockCountDetail}, but `expectedQuantity` may be withheld - see {@link withBlindCounting}. */
export type StockCountDetailView = Omit<StockCountDetail, 'items'> & {
  items: (Omit<StockCountDetail['items'][number], 'expectedQuantity'> & { expectedQuantity: number | null })[];
};

const SEARCHABLE_FIELDS = ['countNumber', 'notes'] as const;

export function buildStockCountWhere(query: StockCountQueryDto): Prisma.StockCountWhereInput {
  const filters: Prisma.StockCountWhereInput = {
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
  };

  const search = searchAcross<Prisma.StockCountWhereInput>(query.search, SEARCHABLE_FIELDS);

  return search === undefined ? filters : { ...filters, ...search };
}

/**
 * Blind counting: while a count is still being walked (DRAFT or COUNTING),
 * `expectedQuantity` is hidden so a counter's entry isn't anchored to what the
 * system already believes. It becomes visible from REVIEW onward, once the
 * point is to compare the two numbers rather than avoid biasing the count.
 */
export function withBlindCounting(count: StockCountDetail): StockCountDetailView {
  if (count.status !== 'DRAFT' && count.status !== 'COUNTING') {
    return count;
  }

  return { ...count, items: count.items.map((item) => ({ ...item, expectedQuantity: null })) };
}
