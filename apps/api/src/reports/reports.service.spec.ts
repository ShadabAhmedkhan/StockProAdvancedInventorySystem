import { Test } from '@nestjs/testing';
import * as tenantContext from '../common/tenant/tenant-context';
import { FinanceService, type FinanceSummary } from '../finance/finance.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockService, type StockSummary } from '../stock/stock.service';
import { ReportsService } from './reports.service';

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

const FINANCE_SUMMARY: FinanceSummary = {
  from: null,
  to: null,
  income: { sale: decimal('0.00'), repairPayment: decimal('0.00'), otherIncome: decimal('0.00'), total: decimal('0.00') },
  refunds: decimal('0.00'),
  expenses: { byCategory: {} as FinanceSummary['expenses']['byCategory'], total: decimal('0.00') },
  netRevenue: decimal('0.00'),
  netPosition: decimal('0.00'),
};

describe('ReportsService', () => {
  let service: ReportsService;
  let queryRaw: jest.Mock;
  let stockSummary: jest.Mock;
  let financeSummary: jest.Mock;

  beforeEach(async () => {
    jest.spyOn(tenantContext, 'getCurrentOrgId').mockReturnValue('org-1');
    queryRaw = jest.fn(() => Promise.resolve([]));
    stockSummary = jest.fn(() => Promise.resolve(STOCK_SUMMARY));
    financeSummary = jest.fn(() => Promise.resolve(FINANCE_SUMMARY));

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
        { provide: StockService, useValue: { summary: stockSummary } },
        { provide: FinanceService, useValue: { summary: financeSummary } },
      ],
    }).compile();

    service = moduleRef.get(ReportsService);
  });

  describe('salesReport', () => {
    it('sums an empty result to zero rather than leaving totals undefined', async () => {
      const report = await service.salesReport({ groupBy: 'day' });

      expect(report.totals.orders).toBe(0);
      expect(report.totals.total.toFixed(2)).toBe('0.00');
      expect(report.points).toEqual([]);
    });

    it('adds each period into the running totals', async () => {
      queryRaw.mockResolvedValue([
        {
          period: new Date('2026-08-01T00:00:00.000Z'),
          orders: 2,
          subtotal: decimal('100.00'),
          discount: decimal('10.00'),
          tax: decimal('8.00'),
          total: decimal('98.00'),
        },
        {
          period: new Date('2026-08-02T00:00:00.000Z'),
          orders: 1,
          subtotal: decimal('50.00'),
          discount: decimal('0.00'),
          tax: decimal('4.00'),
          total: decimal('54.00'),
        },
      ]);

      const report = await service.salesReport({ groupBy: 'day' });

      expect(report.totals.orders).toBe(3);
      expect(report.totals.total.toFixed(2)).toBe('152.00');
      expect(report.points.map((point) => point.period)).toEqual(['2026-08-01', '2026-08-02']);
    });

    it('reports the requested window and grouping back on the result', async () => {
      const from = new Date('2026-08-01T00:00:00.000Z');
      const to = new Date('2026-08-31T00:00:00.000Z');

      const report = await service.salesReport({ from, to, groupBy: 'month' });

      expect(report.from).toBe(from);
      expect(report.to).toBe(to);
      expect(report.groupBy).toBe('month');
    });

    it('reports an unbounded window as null rather than as a made-up date', async () => {
      const report = await service.salesReport({ groupBy: 'day' });

      expect(report.from).toBeNull();
      expect(report.to).toBeNull();
    });
  });

  describe('inventoryReport', () => {
    it('reuses the stock summary for totals rather than re-deriving them', async () => {
      const report = await service.inventoryReport();

      expect(report.totals).toEqual(STOCK_SUMMARY);
    });

    it('returns the per-category breakdown from the query', async () => {
      queryRaw.mockResolvedValue([
        {
          categoryId: 'cat-1',
          categoryName: 'Smartphones',
          productCount: 5,
          totalUnits: 100,
          valueAtCost: decimal('500.00'),
          valueAtRetail: decimal('1000.00'),
          lowStockCount: 1,
          outOfStockCount: 0,
        },
      ]);

      const report = await service.inventoryReport();

      expect(report.categories).toHaveLength(1);
      expect(report.categories[0]?.categoryName).toBe('Smartphones');
    });
  });

  describe('topProducts', () => {
    it('passes the requested limit through to the query', async () => {
      await service.topProducts({ limit: 5 });

      const call = queryRaw.mock.calls[0] as unknown[];
      expect(call).toContain(5);
    });

    it('returns the rows the query produces', async () => {
      queryRaw.mockResolvedValue([{ productId: 'p-1', sku: 'SKU-1', name: 'Widget', quantitySold: 12, revenue: decimal('240.00') }]);

      const products = await service.topProducts({ limit: 10 });

      expect(products).toHaveLength(1);
      expect(products[0]?.sku).toBe('SKU-1');
    });
  });

  describe('advancedAnalytics', () => {
    it('defaults every figure to zero/null rather than throwing when every query comes back empty', async () => {
      const analytics = await service.advancedAnalytics({ deadStockDays: 90 });

      expect(analytics.sales.orderCount).toBe(0);
      expect(analytics.sales.revenue.toFixed(2)).toBe('0.00');
      expect(analytics.sales.margin.toFixed(2)).toBe('0.00');
      expect(analytics.sales.averageOrderValue.toFixed(2)).toBe('0.00');
      expect(analytics.sales.returnRate.toFixed(2)).toBe('0.00');
      expect(analytics.inventory.deadStockCount).toBe(0);
      expect(analytics.inventory.stockTurnover?.toFixed(2)).toBe('0.00');
      expect(analytics.repairs.completionRate.toFixed(2)).toBe('0.00');
      expect(analytics.repairs.avgTurnaroundDays).toBeNull();
      expect(analytics.finance).toEqual(FINANCE_SUMMARY);
    });

    it('derives gross profit, margin and average order value from the sales row', async () => {
      // First $queryRaw call in advancedAnalytics is the sales CTE; every other call still resolves to [] via mockResolvedValueOnce.
      queryRaw.mockResolvedValueOnce([{ orderCount: 4, revenue: decimal('400.00'), subtotal: decimal('420.00'), discount: decimal('20.00'), cogs: decimal('160.00') }]);

      const analytics = await service.advancedAnalytics({ deadStockDays: 90 });

      expect(analytics.sales.grossProfit.toFixed(2)).toBe('240.00');
      expect(analytics.sales.margin.toFixed(2)).toBe('0.60');
      expect(analytics.sales.averageOrderValue.toFixed(2)).toBe('100.00');
      expect(analytics.sales.discountRate.toFixed(4)).toBe('0.0476');
    });

    it('computes stock turnover as COGS over the current inventory cost value', async () => {
      queryRaw.mockResolvedValueOnce([{ orderCount: 1, revenue: decimal('100.00'), subtotal: decimal('100.00'), discount: decimal('0.00'), cogs: decimal('500.00') }]);
      // STOCK_SUMMARY.inventoryValueAtCost is '1000.00' -> turnover = 500/1000 = 0.5.

      const analytics = await service.advancedAnalytics({ deadStockDays: 90 });

      expect(analytics.inventory.stockTurnover?.toFixed(2)).toBe('0.50');
    });

    it('reports stock turnover as null rather than dividing by zero when there is no inventory value', async () => {
      stockSummary.mockResolvedValue({ ...STOCK_SUMMARY, inventoryValueAtCost: '0.00' });

      const analytics = await service.advancedAnalytics({ deadStockDays: 90 });

      expect(analytics.inventory.stockTurnover).toBeNull();
    });
  });
});
