import { searchAcross } from '../common/pagination/search.util';
import { Prisma } from '../generated/prisma/client';
import type { ExpenseQueryDto } from './dto/expense-query.dto';
import type { FinancialTransactionQueryDto } from './dto/financial-transaction-query.dto';
import type { PaymentQueryDto } from './dto/payment-query.dto';

/**
 * How money is read back: what a list row carries and how a query narrows
 * the set. Mirrors the shape used by orders, repairs and returns.
 */

export const EXPENSE_INCLUDE = {
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

export const PAYMENT_INCLUDE = {
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  order: { select: { id: true, orderNumber: true } },
  repair: { select: { id: true, repairNumber: true } },
  returnRecord: { select: { id: true, returnNumber: true } },
} as const;

export const TRANSACTION_INCLUDE = {
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

export type ExpenseWithCreator = Prisma.ExpenseGetPayload<{ include: typeof EXPENSE_INCLUDE }>;
export type PaymentWithRelations = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;
export type TransactionWithCreator = Prisma.FinancialTransactionGetPayload<{ include: typeof TRANSACTION_INCLUDE }>;

const EXPENSE_SEARCHABLE_FIELDS = ['expenseNumber', 'description'] as const;

export function buildExpenseWhere(query: ExpenseQueryDto): Prisma.ExpenseWhereInput {
  const filters: Prisma.ExpenseWhereInput = {
    ...(query.category === undefined ? {} : { category: query.category }),
    ...(query.createdById === undefined ? {} : { createdById: query.createdById }),
    ...(query.expenseFrom === undefined && query.expenseTo === undefined
      ? {}
      : {
          expenseDate: {
            ...(query.expenseFrom === undefined ? {} : { gte: query.expenseFrom }),
            ...(query.expenseTo === undefined ? {} : { lte: query.expenseTo }),
          },
        }),
  };

  const search = searchAcross<Prisma.ExpenseWhereInput>(query.search, EXPENSE_SEARCHABLE_FIELDS);

  return search === undefined ? filters : { ...filters, ...search };
}

const PAYMENT_SEARCHABLE_FIELDS = ['paymentNumber', 'reference'] as const;

export function buildPaymentWhere(query: PaymentQueryDto): Prisma.PaymentWhereInput {
  const filters: Prisma.PaymentWhereInput = {
    ...(query.method === undefined ? {} : { method: query.method }),
    ...(query.referenceType === undefined ? {} : { referenceType: query.referenceType }),
    ...(query.createdById === undefined ? {} : { createdById: query.createdById }),
    ...(query.paidFrom === undefined && query.paidTo === undefined
      ? {}
      : {
          paidAt: {
            ...(query.paidFrom === undefined ? {} : { gte: query.paidFrom }),
            ...(query.paidTo === undefined ? {} : { lte: query.paidTo }),
          },
        }),
  };

  const search = searchAcross<Prisma.PaymentWhereInput>(query.search, PAYMENT_SEARCHABLE_FIELDS);

  return search === undefined ? filters : { ...filters, ...search };
}

const TRANSACTION_SEARCHABLE_FIELDS = ['description'] as const;

export function buildTransactionWhere(query: FinancialTransactionQueryDto): Prisma.FinancialTransactionWhereInput {
  const filters: Prisma.FinancialTransactionWhereInput = {
    ...(query.type === undefined ? {} : { type: query.type }),
    ...(query.referenceType === undefined ? {} : { referenceType: query.referenceType }),
    ...(query.createdById === undefined ? {} : { createdById: query.createdById }),
    ...(query.occurredFrom === undefined && query.occurredTo === undefined
      ? {}
      : {
          occurredAt: {
            ...(query.occurredFrom === undefined ? {} : { gte: query.occurredFrom }),
            ...(query.occurredTo === undefined ? {} : { lte: query.occurredTo }),
          },
        }),
  };

  const search = searchAcross<Prisma.FinancialTransactionWhereInput>(query.search, TRANSACTION_SEARCHABLE_FIELDS);

  return search === undefined ? filters : { ...filters, ...search };
}

/** Bound for a `groupBy`/`aggregate` date filter; `undefined` when neither end is set. */
export function occurredRange(from: Date | undefined, to: Date | undefined): Prisma.DateTimeFilter | undefined {
  if (from === undefined && to === undefined) {
    return undefined;
  }

  return { ...(from === undefined ? {} : { gte: from }), ...(to === undefined ? {} : { lte: to }) };
}
