import { searchAcross } from '../common/pagination/search.util';
import type { Prisma } from '../generated/prisma/client';
import type { OrderQueryDto } from './dto/order-query.dto';

/**
 * How orders are read: what a list row carries, what a single order carries,
 * and how a query narrows the set. Kept apart from the workflow so the shape
 * of a response can be changed without going anywhere near the rules that move
 * stock and money.
 */

export const ORDER_SUMMARY_INCLUDE = {
  customer: { select: { id: true, customerCode: true, firstName: true, lastName: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { items: true } },
} as const;

export const ORDER_DETAIL_INCLUDE = {
  customer: { select: { id: true, customerCode: true, firstName: true, lastName: true, phone: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  items: { include: { product: { select: { id: true, sku: true, name: true } } }, orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { paidAt: 'asc' } },
} as const;

/** How much is still owed. Exact, so no client has to subtract money in a float. */
interface Outstanding {
  outstanding: Prisma.Decimal;
}

export type OrderSummary = Prisma.OrderGetPayload<{ include: typeof ORDER_SUMMARY_INCLUDE }> & Outstanding;
export type OrderDetail = Prisma.OrderGetPayload<{ include: typeof ORDER_DETAIL_INCLUDE }> & Outstanding;

export function withOutstanding<T extends { total: Prisma.Decimal; paidAmount: Prisma.Decimal }>(order: T): T & Outstanding {
  return { ...order, outstanding: order.total.sub(order.paidAmount) };
}

/**
 * Columns a free-text search looks at. Module-owned, never caller-supplied.
 *
 * Customers are found by their own filter rather than by name here: reaching
 * across the relation would turn every order search into a join over the whole
 * customer table, and `customerId` answers the same question exactly.
 */
const SEARCHABLE_FIELDS = ['orderNumber', 'notes'] as const;

export function buildOrderWhere(query: OrderQueryDto): Prisma.OrderWhereInput {
  const filters: Prisma.OrderWhereInput = {
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.paymentStatus === undefined ? {} : { paymentStatus: query.paymentStatus }),
    ...(query.customerId === undefined ? {} : { customerId: query.customerId }),
    ...(query.createdById === undefined ? {} : { createdById: query.createdById }),
    ...(query.createdFrom === undefined && query.createdTo === undefined
      ? {}
      : {
          createdAt: {
            ...(query.createdFrom === undefined ? {} : { gte: query.createdFrom }),
            ...(query.createdTo === undefined ? {} : { lte: query.createdTo }),
          },
        }),
    ...(query.completedFrom === undefined && query.completedTo === undefined
      ? {}
      : {
          completedAt: {
            ...(query.completedFrom === undefined ? {} : { gte: query.completedFrom }),
            ...(query.completedTo === undefined ? {} : { lte: query.completedTo }),
          },
        }),
  };

  const search = searchAcross<Prisma.OrderWhereInput>(query.search, SEARCHABLE_FIELDS);

  return search === undefined ? filters : { ...filters, ...search };
}
