import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { firstCallArg } from '../common/testing/mock-args';
import { Prisma } from '../generated/prisma/client';
import { ExpenseCategory, PaymentMethod, PaymentReferenceType, TransactionReferenceType, TransactionType } from '../generated/prisma/enums';
import { TENANT_PRISMA } from '../prisma/tenant-prisma.provider';
import * as tenantContext from '../common/tenant/tenant-context';
import type { CreateExpenseDto } from './dto/create-expense.dto';
import type { ExpenseQueryDto } from './dto/expense-query.dto';
import type { FinancialTransactionQueryDto } from './dto/financial-transaction-query.dto';
import type { PaymentQueryDto } from './dto/payment-query.dto';
import { FinanceService } from './finance.service';

const EXPENSE_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-0000000000ff';

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function expenseRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: EXPENSE_ID,
    expenseNumber: 'EXP-00000009',
    category: ExpenseCategory.SUPPLIES,
    description: 'Replacement screens',
    amount: decimal('120.00'),
    expenseDate: new Date('2026-08-01T00:00:00.000Z'),
    createdById: USER_ID,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

function expenseQuery(overrides: Partial<ExpenseQueryDto> = {}): ExpenseQueryDto {
  return { page: 1, limit: 20, sortBy: 'expenseDate', sortOrder: 'desc', ...overrides };
}

function paymentQuery(overrides: Partial<PaymentQueryDto> = {}): PaymentQueryDto {
  return { page: 1, limit: 20, sortBy: 'paidAt', sortOrder: 'desc', ...overrides };
}

function transactionQuery(overrides: Partial<FinancialTransactionQueryDto> = {}): FinancialTransactionQueryDto {
  return { page: 1, limit: 20, sortBy: 'occurredAt', sortOrder: 'desc', ...overrides };
}

describe('FinanceService', () => {
  let service: FinanceService;
  let expenseFindMany: jest.Mock;
  let expenseFindUnique: jest.Mock;
  let expenseCreate: jest.Mock;
  let expenseUpdate: jest.Mock;
  let expenseDelete: jest.Mock;
  let expenseCount: jest.Mock;
  let expenseGroupBy: jest.Mock;
  let paymentFindMany: jest.Mock;
  let paymentFindUnique: jest.Mock;
  let paymentCount: jest.Mock;
  let transactionFindMany: jest.Mock;
  let transactionFindUnique: jest.Mock;
  let transactionCreate: jest.Mock;
  let transactionUpdateMany: jest.Mock;
  let transactionDeleteMany: jest.Mock;
  let transactionCount: jest.Mock;
  let transactionGroupBy: jest.Mock;
  let queryRaw: jest.Mock;

  beforeEach(async () => {
    jest.spyOn(tenantContext, 'getCurrentOrgId').mockReturnValue('org-1');
    expenseFindMany = jest.fn(() => Promise.resolve([expenseRow()]));
    expenseFindUnique = jest.fn(() => Promise.resolve(expenseRow()));
    expenseCreate = jest.fn((args: { data: Record<string, unknown> }) => Promise.resolve(expenseRow(args.data)));
    expenseUpdate = jest.fn((args: { data: Record<string, unknown> }) => Promise.resolve(expenseRow(args.data)));
    expenseDelete = jest.fn(() => Promise.resolve(expenseRow()));
    expenseCount = jest.fn(() => Promise.resolve(1));
    expenseGroupBy = jest.fn(() => Promise.resolve([]));

    paymentFindMany = jest.fn(() => Promise.resolve([{ id: 'payment-1' }]));
    paymentFindUnique = jest.fn(() => Promise.resolve({ id: 'payment-1' }));
    paymentCount = jest.fn(() => Promise.resolve(1));

    transactionFindMany = jest.fn(() => Promise.resolve([{ id: 'txn-1' }]));
    transactionFindUnique = jest.fn(() => Promise.resolve({ id: 'txn-1' }));
    transactionCreate = jest.fn((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'txn-1', ...args.data }));
    transactionUpdateMany = jest.fn(() => Promise.resolve({ count: 1 }));
    transactionDeleteMany = jest.fn(() => Promise.resolve({ count: 1 }));
    transactionCount = jest.fn(() => Promise.resolve(1));
    transactionGroupBy = jest.fn(() => Promise.resolve([]));

    // The nextval query for the expense number sequence.
    queryRaw = jest.fn(() => Promise.resolve([{ value: '9' }]));

    const client = {
      expense: {
        findMany: expenseFindMany,
        findUnique: expenseFindUnique,
        create: expenseCreate,
        update: expenseUpdate,
        delete: expenseDelete,
        count: expenseCount,
        groupBy: expenseGroupBy,
      },
      payment: { findMany: paymentFindMany, findUnique: paymentFindUnique, count: paymentCount },
      financialTransaction: {
        findMany: transactionFindMany,
        findUnique: transactionFindUnique,
        create: transactionCreate,
        updateMany: transactionUpdateMany,
        deleteMany: transactionDeleteMany,
        count: transactionCount,
        groupBy: transactionGroupBy,
      },
      $queryRaw: queryRaw,
    };

    const transaction = jest.fn((argument: unknown) =>
      typeof argument === 'function' ? (argument as (tx: typeof client) => Promise<unknown>)(client) : Promise.all(argument as Promise<unknown>[]),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        FinanceService,
        { provide: TENANT_PRISMA, useValue: { ...client, $transaction: transaction } },
        { provide: AuditService, useValue: { record: jest.fn(() => Promise.resolve()) } },
      ],
    }).compile();

    service = moduleRef.get(FinanceService);
  });

  describe('findExpenses', () => {
    it('filters by category', async () => {
      await service.findExpenses(expenseQuery({ category: ExpenseCategory.RENT }));

      const { where } = firstCallArg(expenseFindMany) as { where: { category?: ExpenseCategory } };
      expect(where.category).toBe(ExpenseCategory.RENT);
    });

    it('filters by the expense-date range', async () => {
      const expenseFrom = new Date('2026-08-01T00:00:00.000Z');
      const expenseTo = new Date('2026-08-31T00:00:00.000Z');

      await service.findExpenses(expenseQuery({ expenseFrom, expenseTo }));

      const { where } = firstCallArg(expenseFindMany) as { where: { expenseDate?: { gte: Date; lte: Date } } };
      expect(where.expenseDate).toEqual({ gte: expenseFrom, lte: expenseTo });
    });

    it('searches the expense number and description', async () => {
      await service.findExpenses(expenseQuery({ search: 'screen' }));

      const { where } = firstCallArg(expenseFindMany) as { where: { AND?: unknown } };
      expect(where.AND).toEqual([
        { OR: [{ expenseNumber: { contains: 'screen', mode: 'insensitive' } }, { description: { contains: 'screen', mode: 'insensitive' } }] },
      ]);
    });
  });

  describe('findExpense', () => {
    it('throws NotFoundException for an expense that does not exist', async () => {
      expenseFindUnique.mockResolvedValue(null);

      await expect(service.findExpense(EXPENSE_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('createExpense', () => {
    const dto: CreateExpenseDto = { category: ExpenseCategory.SUPPLIES, description: 'Replacement screens', amount: '120.00' };

    it('draws an expense number from the sequence', async () => {
      await service.createExpense(dto, USER_ID);

      const { data } = firstCallArg(expenseCreate) as { data: { expenseNumber: string } };
      expect(data.expenseNumber).toBe('EXP-00000009');
    });

    it('defaults the expense date to today when none is supplied', async () => {
      await service.createExpense(dto, USER_ID);

      const { data } = firstCallArg(expenseCreate) as { data: { expenseDate: Date } };
      expect(data.expenseDate).toBeInstanceOf(Date);
    });

    it('keeps a caller-supplied expense date', async () => {
      const expenseDate = new Date('2026-07-15T00:00:00.000Z');

      await service.createExpense({ category: dto.category, description: dto.description, amount: dto.amount, expenseDate }, USER_ID);

      const { data } = firstCallArg(expenseCreate) as { data: { expenseDate: Date } };
      expect(data.expenseDate).toBe(expenseDate);
    });

    it('writes a ledger entry describing the same expense', async () => {
      await service.createExpense(dto, USER_ID);

      const { data } = firstCallArg(transactionCreate) as {
        data: { type: TransactionType; amount: string; description: string; referenceType: TransactionReferenceType; referenceId: string; createdById: string };
      };
      expect(data.type).toBe(TransactionType.EXPENSE);
      expect(data.amount).toBe('120.00');
      expect(data.description).toBe('Replacement screens');
      expect(data.referenceType).toBe(TransactionReferenceType.EXPENSE);
      expect(data.referenceId).toBe(EXPENSE_ID);
      expect(data.createdById).toBe(USER_ID);
    });
  });

  describe('updateExpense', () => {
    it('updates only the supplied fields on the expense row', async () => {
      await service.updateExpense(EXPENSE_ID, { category: ExpenseCategory.RENT }, USER_ID);

      const { data } = firstCallArg(expenseUpdate) as { data: Record<string, unknown> };
      expect(data).toEqual({ category: ExpenseCategory.RENT });
    });

    it('keeps the ledger amount, description and date when only the category changes', async () => {
      await service.updateExpense(EXPENSE_ID, { category: ExpenseCategory.RENT }, USER_ID);

      const { data } = firstCallArg(transactionUpdateMany) as { data: { amount: Prisma.Decimal; description: string; occurredAt: Date } };
      expect(data.amount.toFixed(2)).toBe('120.00');
      expect(data.description).toBe('Replacement screens');
      expect(data.occurredAt).toEqual(new Date('2026-08-01T00:00:00.000Z'));
    });

    it('syncs the ledger amount when the expense amount changes', async () => {
      await service.updateExpense(EXPENSE_ID, { amount: '200.00' }, USER_ID);

      const { data } = firstCallArg(transactionUpdateMany) as { data: { amount: Prisma.Decimal } };
      expect(data.amount.toFixed(2)).toBe('200.00');
    });

    it('scopes the ledger sync to this expense alone', async () => {
      await service.updateExpense(EXPENSE_ID, { category: ExpenseCategory.RENT }, USER_ID);

      const { where } = firstCallArg(transactionUpdateMany) as { where: { referenceType: TransactionReferenceType; referenceId: string } };
      expect(where).toEqual({ referenceType: TransactionReferenceType.EXPENSE, referenceId: EXPENSE_ID });
    });

    it('throws NotFoundException for an expense that does not exist', async () => {
      expenseFindUnique.mockResolvedValue(null);

      await expect(service.updateExpense(EXPENSE_ID, { category: ExpenseCategory.RENT }, USER_ID)).rejects.toThrow(NotFoundException);
      expect(expenseUpdate).not.toHaveBeenCalled();
    });
  });

  describe('removeExpense', () => {
    it('deletes the ledger entry scoped to this expense, and the expense itself', async () => {
      await service.removeExpense(EXPENSE_ID, USER_ID);

      const { where } = firstCallArg(transactionDeleteMany) as { where: { referenceType: TransactionReferenceType; referenceId: string } };
      expect(where).toEqual({ referenceType: TransactionReferenceType.EXPENSE, referenceId: EXPENSE_ID });
      expect(expenseDelete).toHaveBeenCalledWith({ where: { id: EXPENSE_ID } });
    });

    it('returns the removed expense', async () => {
      const removed = await service.removeExpense(EXPENSE_ID, USER_ID);

      expect(removed.id).toBe(EXPENSE_ID);
    });

    it('throws NotFoundException for an expense that does not exist', async () => {
      expenseFindUnique.mockResolvedValue(null);

      await expect(service.removeExpense(EXPENSE_ID, USER_ID)).rejects.toThrow(NotFoundException);
      expect(expenseDelete).not.toHaveBeenCalled();
    });
  });

  describe('findPayments', () => {
    it('filters by method', async () => {
      await service.findPayments(paymentQuery({ method: PaymentMethod.CASH }));

      const { where } = firstCallArg(paymentFindMany) as { where: { method?: PaymentMethod } };
      expect(where.method).toBe(PaymentMethod.CASH);
    });

    it('filters by reference type', async () => {
      await service.findPayments(paymentQuery({ referenceType: PaymentReferenceType.ORDER }));

      const { where } = firstCallArg(paymentFindMany) as { where: { referenceType?: PaymentReferenceType } };
      expect(where.referenceType).toBe(PaymentReferenceType.ORDER);
    });
  });

  describe('findPayment', () => {
    it('throws NotFoundException for a payment that does not exist', async () => {
      paymentFindUnique.mockResolvedValue(null);

      await expect(service.findPayment('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findTransactions', () => {
    it('filters by type', async () => {
      await service.findTransactions(transactionQuery({ type: TransactionType.REFUND }));

      const { where } = firstCallArg(transactionFindMany) as { where: { type?: TransactionType } };
      expect(where.type).toBe(TransactionType.REFUND);
    });

    it('filters by reference type', async () => {
      await service.findTransactions(transactionQuery({ referenceType: TransactionReferenceType.RETURN }));

      const { where } = firstCallArg(transactionFindMany) as { where: { referenceType?: TransactionReferenceType } };
      expect(where.referenceType).toBe(TransactionReferenceType.RETURN);
    });
  });

  describe('findTransaction', () => {
    it('throws NotFoundException for a ledger entry that does not exist', async () => {
      transactionFindUnique.mockResolvedValue(null);

      await expect(service.findTransaction('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('recordOtherIncome', () => {
    it('writes an OTHER_INCOME entry with no reference', async () => {
      await service.recordOtherIncome({ amount: '75.00', description: 'Scrap metal sale' }, USER_ID);

      const { data } = firstCallArg(transactionCreate) as { data: Record<string, unknown> };
      expect(data.type).toBe(TransactionType.OTHER_INCOME);
      expect(data.amount).toBe('75.00');
      expect(data).not.toHaveProperty('referenceType');
      expect(data).not.toHaveProperty('referenceId');
    });

    it('defaults occurredAt to now when none is supplied', async () => {
      await service.recordOtherIncome({ amount: '75.00', description: 'Scrap metal sale' }, USER_ID);

      const { data } = firstCallArg(transactionCreate) as { data: { occurredAt: Date } };
      expect(data.occurredAt).toBeInstanceOf(Date);
    });

    it('keeps a caller-supplied occurredAt', async () => {
      const occurredAt = new Date('2026-07-01T00:00:00.000Z');

      await service.recordOtherIncome({ amount: '75.00', description: 'Scrap metal sale', occurredAt }, USER_ID);

      const { data } = firstCallArg(transactionCreate) as { data: { occurredAt: Date } };
      expect(data.occurredAt).toBe(occurredAt);
    });
  });

  describe('summary', () => {
    it('reports zero for every figure when the ledger is empty', async () => {
      const result = await service.summary({});

      expect(result.income.total.toFixed(2)).toBe('0.00');
      expect(result.refunds.toFixed(2)).toBe('0.00');
      expect(result.expenses.total.toFixed(2)).toBe('0.00');
      expect(result.netRevenue.toFixed(2)).toBe('0.00');
      expect(result.netPosition.toFixed(2)).toBe('0.00');
      expect(Object.values(result.expenses.byCategory).every((amount) => amount.toFixed(2) === '0.00')).toBe(true);
    });

    it('derives income, refunds, expenses and net position from the ledger', async () => {
      transactionGroupBy.mockResolvedValue([
        { type: TransactionType.SALE, _sum: { amount: decimal('1000.00') } },
        { type: TransactionType.REPAIR_PAYMENT, _sum: { amount: decimal('200.00') } },
        { type: TransactionType.OTHER_INCOME, _sum: { amount: decimal('50.00') } },
        { type: TransactionType.REFUND, _sum: { amount: decimal('80.00') } },
        { type: TransactionType.EXPENSE, _sum: { amount: decimal('300.00') } },
      ]);
      expenseGroupBy.mockResolvedValue([{ category: ExpenseCategory.RENT, _sum: { amount: decimal('300.00') } }]);

      const result = await service.summary({});

      expect(result.income.sale.toFixed(2)).toBe('1000.00');
      expect(result.income.repairPayment.toFixed(2)).toBe('200.00');
      expect(result.income.otherIncome.toFixed(2)).toBe('50.00');
      // Sale + repair payment + other income, refunds are not income.
      expect(result.income.total.toFixed(2)).toBe('1250.00');
      expect(result.refunds.toFixed(2)).toBe('80.00');
      // Income net of refunds.
      expect(result.netRevenue.toFixed(2)).toBe('1170.00');
      expect(result.expenses.total.toFixed(2)).toBe('300.00');
      // Net revenue after expenses.
      expect(result.netPosition.toFixed(2)).toBe('870.00');
      expect(result.expenses.byCategory[ExpenseCategory.RENT].toFixed(2)).toBe('300.00');
      expect(result.expenses.byCategory[ExpenseCategory.UTILITIES].toFixed(2)).toBe('0.00');
    });

    it('applies the date range to both the ledger and the expense query', async () => {
      const from = new Date('2026-08-01T00:00:00.000Z');
      const to = new Date('2026-08-31T23:59:59.999Z');

      await service.summary({ from, to });

      const { where: transactionWhere } = firstCallArg(transactionGroupBy) as { where: { occurredAt?: { gte: Date; lte: Date } } };
      expect(transactionWhere.occurredAt).toEqual({ gte: from, lte: to });

      const { where: expenseWhere } = firstCallArg(expenseGroupBy) as { where: { expenseDate?: { gte: Date; lte: Date } } };
      expect(expenseWhere.expenseDate).toEqual({ gte: from, lte: to });
    });

    it('omits the date filter entirely when neither end is supplied', async () => {
      await service.summary({});

      const { where: transactionWhere } = firstCallArg(transactionGroupBy) as { where: Record<string, unknown> };
      expect(transactionWhere).toEqual({});

      const { where: expenseWhere } = firstCallArg(expenseGroupBy) as { where: Record<string, unknown> };
      expect(expenseWhere).toEqual({});
    });
  });
});
