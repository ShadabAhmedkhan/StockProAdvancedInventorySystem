import { Test } from '@nestjs/testing';
import { firstCallArg } from '../common/testing/mock-args';
import { FinanceService } from '../finance/finance.service';
import { Prisma } from '../generated/prisma/client';
import { OrderStatus, ReturnStatus, TransactionType } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { StockService, type StockSummary } from '../stock/stock.service';
import { DashboardService } from './dashboard.service';

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

const STOCK_SUMMARY: StockSummary = {
  totalProducts: 20,
  totalUnits: 900,
  inventoryValueAtCost: '1000.00',
  inventoryValueAtRetail: '2000.00',
  lowStockCount: 2,
  outOfStockCount: 1,
};

describe('DashboardService', () => {
  let service: DashboardService;
  let orderCount: jest.Mock;
  let repairCount: jest.Mock;
  let repairGroupBy: jest.Mock;
  let returnCount: jest.Mock;
  let customerCount: jest.Mock;
  let orderFindMany: jest.Mock;
  let financialTransactionAggregate: jest.Mock;
  let queryRaw: jest.Mock;
  let financeSummary: jest.Mock;
  let stockSummary: jest.Mock;
  let findMovements: jest.Mock;

  beforeEach(async () => {
    orderCount = jest.fn(() => Promise.resolve(6));
    repairCount = jest.fn(() => Promise.resolve(2));
    repairGroupBy = jest.fn(() => Promise.resolve([]));
    returnCount = jest.fn(() => Promise.resolve(1));
    customerCount = jest.fn(() => Promise.resolve(8));
    orderFindMany = jest.fn(() => Promise.resolve([]));
    financialTransactionAggregate = jest.fn(() => Promise.resolve({ _sum: { amount: decimal('50.00') } }));
    queryRaw = jest.fn(() => Promise.resolve([]));

    financeSummary = jest.fn(() =>
      Promise.resolve({
        from: null,
        to: null,
        income: { sale: decimal('500.00'), repairPayment: decimal('100.00'), otherIncome: decimal('0.00'), total: decimal('600.00') },
        refunds: decimal('20.00'),
        expenses: { byCategory: {}, total: decimal('80.00') },
        netRevenue: decimal('580.00'),
        netPosition: decimal('500.00'),
      }),
    );
    stockSummary = jest.fn(() => Promise.resolve(STOCK_SUMMARY));
    findMovements = jest.fn(() => Promise.resolve({ items: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } }));

    const prismaMock = {
      order: { count: orderCount, findMany: orderFindMany },
      repair: { count: repairCount, groupBy: repairGroupBy },
      return: { count: returnCount },
      customer: { count: customerCount },
      financialTransaction: { aggregate: financialTransactionAggregate },
      $queryRaw: queryRaw,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: FinanceService, useValue: { summary: financeSummary } },
        { provide: StockService, useValue: { summary: stockSummary, findMovements } },
      ],
    }).compile();

    service = moduleRef.get(DashboardService);
  });

  it('counts only completed orders as total sales', async () => {
    await service.summary();

    const { where } = firstCallArg(orderCount) as { where: { status: OrderStatus } };
    expect(where.status).toBe(OrderStatus.COMPLETED);
  });

  it('reuses the finance summary for gross revenue, expenses and net position rather than re-deriving them', async () => {
    const result = await service.summary();

    expect(result.sales.grossRevenue.toFixed(2)).toBe('600.00');
    expect(result.finance.expenses.toFixed(2)).toBe('80.00');
    expect(result.finance.netPosition.toFixed(2)).toBe('500.00');
  });

  it('reuses the stock summary for inventory figures rather than re-deriving them', async () => {
    const result = await service.summary();

    expect(result.inventory).toEqual(STOCK_SUMMARY);
  });

  it("today's sales are scoped to SALE transactions from midnight onward", async () => {
    await service.summary();

    const { where } = firstCallArg(financialTransactionAggregate) as { where: { type: TransactionType; occurredAt: { gte: Date } } };
    expect(where.type).toBe(TransactionType.SALE);
    expect(where.occurredAt.gte.getUTCHours()).toBe(0);
    expect(where.occurredAt.gte.getUTCMinutes()).toBe(0);
  });

  it("this month's sales window starts on the first of the month", async () => {
    await service.summary();

    const calls = financialTransactionAggregate.mock.calls as { where: { occurredAt: { gte: Date } } }[][];
    const { where } = calls[1]?.[0] ?? { where: { occurredAt: { gte: new Date(0) } } };
    expect(where.occurredAt.gte.getUTCDate()).toBe(1);
  });

  it('counts pending returns', async () => {
    await service.summary();

    const { where } = firstCallArg(returnCount) as { where: { status: ReturnStatus } };
    expect(where.status).toBe(ReturnStatus.PENDING);
  });

  it('counts only customers that have not been soft-deleted', async () => {
    await service.summary();

    const { where } = firstCallArg(customerCount) as { where: { deletedAt: null } };
    expect(where.deletedAt).toBeNull();
  });

  it('reads recent stock movements from the shared stock listing', async () => {
    await service.summary();

    expect(findMovements).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'createdAt', sortOrder: 'desc' }));
  });

  it('maps recent sales to a display name, or null for a walk-in customer', async () => {
    orderFindMany.mockResolvedValue([
      { id: 'order-1', orderNumber: 'ORD-00000001', total: decimal('40.00'), completedAt: new Date(), customer: { firstName: 'Ana', lastName: 'Reyes' } },
      { id: 'order-2', orderNumber: 'ORD-00000002', total: decimal('10.00'), completedAt: new Date(), customer: null },
    ]);

    const result = await service.summary();

    expect(result.recentSales[0]?.customerName).toBe('Ana Reyes');
    expect(result.recentSales[1]?.customerName).toBeNull();
  });
});
