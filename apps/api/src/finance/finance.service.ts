import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { nextDocumentNumber } from '../common/documents/document-number';
import { ErrorCode } from '../common/enums/error-code.enum';
import { pageWindow, paginate, type Paginated } from '../common/pagination/paginated';
import { getCurrentOrgId } from '../common/tenant/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { AuditAction, AuditEntity, ExpenseCategory, TransactionReferenceType, TransactionType } from '../generated/prisma/enums';
import { TENANT_PRISMA, type TenantPrismaClient } from '../prisma/tenant-prisma.provider';
import type { CreateExpenseDto } from './dto/create-expense.dto';
import type { CreateOtherIncomeDto } from './dto/create-other-income.dto';
import type { ExpenseQueryDto } from './dto/expense-query.dto';
import type { FinanceSummaryQueryDto } from './dto/finance-summary-query.dto';
import type { FinancialTransactionQueryDto } from './dto/financial-transaction-query.dto';
import type { PaymentQueryDto } from './dto/payment-query.dto';
import type { UpdateExpenseDto } from './dto/update-expense.dto';
import {
  buildExpenseWhere,
  buildPaymentWhere,
  buildTransactionWhere,
  EXPENSE_INCLUDE,
  occurredRange,
  PAYMENT_INCLUDE,
  TRANSACTION_INCLUDE,
  type ExpenseWithCreator,
  type PaymentWithRelations,
  type TransactionWithCreator,
} from './finance-views';

const ZERO = new Prisma.Decimal(0);

export interface FinanceSummary {
  from: Date | null;
  to: Date | null;
  income: {
    sale: Prisma.Decimal;
    repairPayment: Prisma.Decimal;
    otherIncome: Prisma.Decimal;
    total: Prisma.Decimal;
  };
  refunds: Prisma.Decimal;
  expenses: {
    byCategory: Record<ExpenseCategory, Prisma.Decimal>;
    total: Prisma.Decimal;
  };
  /** Income actually collected, net of refunds. */
  netRevenue: Prisma.Decimal;
  /** Net revenue after expenses - what the shop is actually left with. */
  netPosition: Prisma.Decimal;
}

/**
 * Expenses, payments and the financial ledger.
 *
 * Orders, repairs and returns each write their own `Payment` rows; this
 * module never writes one. It owns `Expense` - the one kind of outflow with
 * nowhere else to live - and the `FinancialTransaction` ledger that both
 * expenses and every other module's payments feed into, which is what
 * `summary()` reads rather than re-deriving totals by joining every source
 * table on every request.
 */
@Injectable()
export class FinanceService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient,
    private readonly auditService: AuditService,
  ) {}

  async findExpenses(query: ExpenseQueryDto): Promise<Paginated<ExpenseWithCreator>> {
    const where = buildExpenseWhere(query);
    const { skip, take } = pageWindow(query.page, query.limit);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.expense.findMany({ where, include: EXPENSE_INCLUDE, orderBy: { [query.sortBy]: query.sortOrder }, skip, take }),
      this.prisma.expense.count({ where }),
    ]);

    return paginate(items, total, query.page, query.limit);
  }

  async findExpense(id: string): Promise<ExpenseWithCreator> {
    const expense = await this.prisma.expense.findUnique({ where: { id }, include: EXPENSE_INCLUDE });

    if (expense === null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Expense not found' });
    }

    return expense;
  }

  /** Records the outflow and, in the same transaction, the ledger entry it implies. */
  async createExpense(dto: CreateExpenseDto, userId: string): Promise<ExpenseWithCreator> {
    const expenseDate = dto.expenseDate ?? new Date();

    const organizationId = getCurrentOrgId();

    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          organizationId,
          expenseNumber: await nextDocumentNumber(tx, 'EXPENSE'),
          category: dto.category,
          description: dto.description,
          amount: dto.amount,
          expenseDate,
          createdById: userId,
        },
        include: EXPENSE_INCLUDE,
      });

      await tx.financialTransaction.create({
        data: {
          organizationId,
          type: TransactionType.EXPENSE,
          amount: dto.amount,
          description: dto.description,
          occurredAt: expenseDate,
          referenceType: TransactionReferenceType.EXPENSE,
          referenceId: expense.id,
          createdById: userId,
        },
      });

      await this.auditService.record(
        {
          userId,
          action: AuditAction.CREATE,
          entity: AuditEntity.EXPENSE,
          entityId: expense.id,
          metadata: { expenseNumber: expense.expenseNumber, amount: dto.amount },
        },
        tx,
      );

      return expense;
    });
  }

  /** Edits the outflow and keeps its ledger entry describing the same thing. */
  async updateExpense(id: string, dto: UpdateExpenseDto, callerId: string): Promise<ExpenseWithCreator> {
    const existing = await this.findExpense(id);

    const description = dto.description ?? existing.description;
    const amount = dto.amount === undefined ? existing.amount : new Prisma.Decimal(dto.amount);
    const expenseDate = dto.expenseDate ?? existing.expenseDate;

    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.update({
        where: { id },
        data: {
          ...(dto.category === undefined ? {} : { category: dto.category }),
          ...(dto.description === undefined ? {} : { description: dto.description }),
          ...(dto.amount === undefined ? {} : { amount: dto.amount }),
          ...(dto.expenseDate === undefined ? {} : { expenseDate: dto.expenseDate }),
        },
        include: EXPENSE_INCLUDE,
      });

      await tx.financialTransaction.updateMany({
        where: { referenceType: TransactionReferenceType.EXPENSE, referenceId: id },
        data: { amount, description, occurredAt: expenseDate },
      });

      await this.auditService.record(
        { userId: callerId, action: AuditAction.UPDATE, entity: AuditEntity.EXPENSE, entityId: id, metadata: { changed: Object.keys(dto) } },
        tx,
      );

      return expense;
    });
  }

  /** Removes the outflow and the ledger entry it wrote; an expense entered by mistake leaves no trace of either. */
  async removeExpense(id: string, callerId: string): Promise<ExpenseWithCreator> {
    const existing = await this.findExpense(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.financialTransaction.deleteMany({ where: { referenceType: TransactionReferenceType.EXPENSE, referenceId: id } });
      await tx.expense.delete({ where: { id } });
      await this.auditService.record(
        { userId: callerId, action: AuditAction.DELETE, entity: AuditEntity.EXPENSE, entityId: id, metadata: { expenseNumber: existing.expenseNumber } },
        tx,
      );
    });

    return existing;
  }

  async findPayments(query: PaymentQueryDto): Promise<Paginated<PaymentWithRelations>> {
    const where = buildPaymentWhere(query);
    const { skip, take } = pageWindow(query.page, query.limit);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({ where, include: PAYMENT_INCLUDE, orderBy: { [query.sortBy]: query.sortOrder }, skip, take }),
      this.prisma.payment.count({ where }),
    ]);

    return paginate(items, total, query.page, query.limit);
  }

  async findPayment(id: string): Promise<PaymentWithRelations> {
    const payment = await this.prisma.payment.findUnique({ where: { id }, include: PAYMENT_INCLUDE });

    if (payment === null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Payment not found' });
    }

    return payment;
  }

  async findTransactions(query: FinancialTransactionQueryDto): Promise<Paginated<TransactionWithCreator>> {
    const where = buildTransactionWhere(query);
    const { skip, take } = pageWindow(query.page, query.limit);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.financialTransaction.findMany({ where, include: TRANSACTION_INCLUDE, orderBy: { [query.sortBy]: query.sortOrder }, skip, take }),
      this.prisma.financialTransaction.count({ where }),
    ]);

    return paginate(items, total, query.page, query.limit);
  }

  async findTransaction(id: string): Promise<TransactionWithCreator> {
    const transaction = await this.prisma.financialTransaction.findUnique({ where: { id }, include: TRANSACTION_INCLUDE });

    if (transaction === null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Financial transaction not found' });
    }

    return transaction;
  }

  /**
   * The one kind of ledger entry a caller may write directly - money that
   * arrived outside a sale, a repair or a return. Everything else in the
   * ledger is written by the module that actually moved the money.
   */
  async recordOtherIncome(dto: CreateOtherIncomeDto, userId: string): Promise<TransactionWithCreator> {
    return this.prisma.financialTransaction.create({
      data: {
        organizationId: getCurrentOrgId(),
        type: TransactionType.OTHER_INCOME,
        amount: dto.amount,
        description: dto.description,
        occurredAt: dto.occurredAt ?? new Date(),
        createdById: userId,
      },
      include: TRANSACTION_INCLUDE,
    });
  }

  /**
   * Reads the ledger rather than re-deriving totals from every source table:
   * that is what `FinancialTransaction` is for. Only the expense-by-category
   * breakdown comes from `Expense` directly, since the ledger does not carry
   * a category.
   */
  async summary(query: FinanceSummaryQueryDto): Promise<FinanceSummary> {
    const range = occurredRange(query.from, query.to);

    const [transactionTotals, categoryTotals] = await Promise.all([
      this.prisma.financialTransaction.groupBy({
        by: ['type'],
        where: range === undefined ? {} : { occurredAt: range },
        _sum: { amount: true },
      }),
      this.prisma.expense.groupBy({
        by: ['category'],
        where: range === undefined ? {} : { expenseDate: range },
        _sum: { amount: true },
      }),
    ]);

    const byType = new Map(transactionTotals.map((row) => [row.type, row._sum.amount ?? ZERO]));
    const sale = byType.get(TransactionType.SALE) ?? ZERO;
    const repairPayment = byType.get(TransactionType.REPAIR_PAYMENT) ?? ZERO;
    const otherIncome = byType.get(TransactionType.OTHER_INCOME) ?? ZERO;
    const refunds = byType.get(TransactionType.REFUND) ?? ZERO;
    const expenseTotal = byType.get(TransactionType.EXPENSE) ?? ZERO;

    const income = sale.add(repairPayment).add(otherIncome);
    const netRevenue = income.sub(refunds);

    const byCategoryTotals = new Map(categoryTotals.map((row) => [row.category, row._sum.amount ?? ZERO]));
    const byCategory = Object.fromEntries(Object.values(ExpenseCategory).map((category) => [category, byCategoryTotals.get(category) ?? ZERO])) as Record<
      ExpenseCategory,
      Prisma.Decimal
    >;

    return {
      from: query.from ?? null,
      to: query.to ?? null,
      income: { sale, repairPayment, otherIncome, total: income },
      refunds,
      expenses: { byCategory, total: expenseTotal },
      netRevenue,
      netPosition: netRevenue.sub(expenseTotal),
    };
  }
}
