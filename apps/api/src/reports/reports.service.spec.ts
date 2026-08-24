import { Test } from '@nestjs/testing';
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

describe('ReportsService', () => {
  let service: ReportsService;
  let queryRaw: jest.Mock;
  let stockSummary: jest.Mock;

  beforeEach(async () => {
    queryRaw = jest.fn(() => Promise.resolve([]));
    stockSummary = jest.fn(() => Promise.resolve(STOCK_SUMMARY));

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
        { provide: StockService, useValue: { summary: stockSummary } },
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
});
