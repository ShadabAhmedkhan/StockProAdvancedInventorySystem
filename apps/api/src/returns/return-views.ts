import { searchAcross } from '../common/pagination/search.util';
import { Prisma } from '../generated/prisma/client';
import type { ReturnQueryDto } from './dto/return-query.dto';

/**
 * How returns are read: what a list row carries, what a single return carries,
 * and how a query narrows the set.
 */

const ZERO = new Prisma.Decimal(0);

export const RETURN_SUMMARY_INCLUDE = {
  order: { select: { id: true, orderNumber: true, total: true, paidAmount: true } },
  customer: { select: { id: true, customerCode: true, firstName: true, lastName: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  payments: { select: { amount: true } },
  _count: { select: { items: true } },
} as const;

export const RETURN_DETAIL_INCLUDE = {
  order: { select: { id: true, orderNumber: true, total: true, paidAmount: true, completedAt: true } },
  customer: { select: { id: true, customerCode: true, firstName: true, lastName: true, phone: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  items: {
    include: {
      product: { select: { id: true, sku: true, name: true } },
      orderItem: { select: { id: true, quantity: true, unitPrice: true, total: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
  payments: { orderBy: { paidAt: 'asc' } },
} as const;

type ReturnSummaryRow = Prisma.ReturnGetPayload<{ include: typeof RETURN_SUMMARY_INCLUDE }>;
type ReturnDetailRow = Prisma.ReturnGetPayload<{ include: typeof RETURN_DETAIL_INCLUDE }>;

/**
 * What a return implies rather than stores.
 *
 * `refundAmount` is the credit: what the returned goods were charged at.
 * `paidBackAmount` is the money that actually went back, which can be smaller
 * when the order was never paid in full - the rest of the credit stands
 * against goods nobody had paid for. `outstandingCredit` is the difference.
 */
export interface ReturnAmounts {
  paidBackAmount: Prisma.Decimal;
  outstandingCredit: Prisma.Decimal;
}

export type ReturnSummary = Omit<ReturnSummaryRow, 'payments'> & ReturnAmounts;
export type ReturnDetail = ReturnDetailRow & ReturnAmounts;

function amountsFor(payments: readonly { amount: Prisma.Decimal }[], refundAmount: Prisma.Decimal): ReturnAmounts {
  const paidBackAmount = payments.reduce<Prisma.Decimal>((sum, payment) => sum.add(payment.amount), ZERO);

  return { paidBackAmount, outstandingCredit: refundAmount.sub(paidBackAmount) };
}

/** The list drops the raw refunds it only loaded to add them up. */
export function toReturnSummary(row: ReturnSummaryRow): ReturnSummary {
  const { payments, ...record } = row;

  return { ...record, ...amountsFor(payments, record.refundAmount) };
}

export function toReturnDetail(row: ReturnDetailRow): ReturnDetail {
  return { ...row, ...amountsFor(row.payments, row.refundAmount) };
}

/**
 * Columns a free-text search looks at. Module-owned, never caller-supplied.
 *
 * The order number is here because a customer at the counter has the receipt
 * in their hand, not the return note.
 */
const SEARCHABLE_FIELDS = ['returnNumber', 'reasonNote'] as const;

export function buildReturnWhere(query: ReturnQueryDto): Prisma.ReturnWhereInput {
  const filters: Prisma.ReturnWhereInput = {
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.reason === undefined ? {} : { reason: query.reason }),
    ...(query.orderId === undefined ? {} : { orderId: query.orderId }),
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

  const search = searchAcross<Prisma.ReturnWhereInput>(query.search, SEARCHABLE_FIELDS);

  return search === undefined ? filters : { ...filters, ...search };
}
