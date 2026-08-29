import { Test } from '@nestjs/testing';
import { FinanceService } from '../finance/finance.service';
import { ReportsService } from '../reports/reports.service';
import { StockStatusFilter } from '../stock/dto/stock-query.dto';
import { StockService } from '../stock/stock.service';
import { AiToolsService } from './ai-tools.service';

describe('AiToolsService', () => {
  let service: AiToolsService;
  let advancedAnalytics: jest.Mock;
  let topProducts: jest.Mock;
  let stockSummary: jest.Mock;
  let stockFindAll: jest.Mock;
  let findReorderSuggestions: jest.Mock;
  let financeSummary: jest.Mock;

  beforeEach(async () => {
    advancedAnalytics = jest.fn(() =>
      Promise.resolve({
        sales: { orderCount: 3 },
        inventory: { deadStockCount: 5, aging: [] },
        purchasing: { suppliers: [] },
        repairs: { completionRate: '1.00' },
      }),
    );
    topProducts = jest.fn(() => Promise.resolve([{ productId: 'p1' }]));
    stockSummary = jest.fn(() => Promise.resolve({ totalProducts: 10 }));
    stockFindAll = jest.fn(() => Promise.resolve({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }));
    findReorderSuggestions = jest.fn(() => Promise.resolve({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }));
    financeSummary = jest.fn(() => Promise.resolve({ netRevenue: '100.00' }));

    const moduleRef = await Test.createTestingModule({
      providers: [
        AiToolsService,
        { provide: ReportsService, useValue: { advancedAnalytics, topProducts } },
        { provide: StockService, useValue: { summary: stockSummary, findAll: stockFindAll, findReorderSuggestions } },
        { provide: FinanceService, useValue: { summary: financeSummary } },
      ],
    }).compile();

    service = moduleRef.get(AiToolsService);
  });

  it('getSalesSummary delegates to ReportsService.advancedAnalytics and returns .sales', async () => {
    const result = await service.getSalesSummary({ from: '2026-01-01', to: '2026-01-31' });

    expect(advancedAnalytics).toHaveBeenCalledWith({ from: new Date('2026-01-01'), to: new Date('2026-01-31'), deadStockDays: 90 });
    expect(result).toEqual({ orderCount: 3 });
  });

  it('getInventorySummary delegates to StockService.summary', async () => {
    const result = await service.getInventorySummary();

    expect(stockSummary).toHaveBeenCalledWith();
    expect(result).toEqual({ totalProducts: 10 });
  });

  it('getLowStock delegates to StockService.findAll filtered to LOW stock', async () => {
    await service.getLowStock({ limit: 5 });

    expect(stockFindAll).toHaveBeenCalledWith(expect.objectContaining({ stockStatus: StockStatusFilter.LOW, limit: 5 }));
  });

  it('getLowStock falls back to a default limit for an invalid input', async () => {
    await service.getLowStock({ limit: -1 });

    expect(stockFindAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }));
  });

  it('getInventoryAging delegates to ReportsService.advancedAnalytics and returns .inventory', async () => {
    const result = await service.getInventoryAging({});

    expect(advancedAnalytics).toHaveBeenCalledWith({ from: undefined, to: undefined, deadStockDays: 90 });
    expect(result).toEqual({ deadStockCount: 5, aging: [] });
  });

  it('getTopProducts delegates to ReportsService.topProducts', async () => {
    const result = await service.getTopProducts({ limit: 3 });

    expect(topProducts).toHaveBeenCalledWith({ from: undefined, to: undefined, limit: 3 });
    expect(result).toEqual([{ productId: 'p1' }]);
  });

  it('getSlowProducts reuses advancedAnalytics deadStockCount and reports it as a count, not a list', async () => {
    const result = await service.getSlowProducts({ days: 60 });

    expect(advancedAnalytics).toHaveBeenCalledWith({ from: undefined, to: undefined, deadStockDays: 60 });
    expect(result.deadStockDays).toBe(60);
    expect(result.deadStockCount).toBe(5);
    expect(typeof result.note).toBe('string');
  });

  it('getFinanceSummary delegates to FinanceService.summary', async () => {
    const result = await service.getFinanceSummary({ from: '2026-01-01' });

    expect(financeSummary).toHaveBeenCalledWith({ from: new Date('2026-01-01'), to: undefined });
    expect(result).toEqual({ netRevenue: '100.00' });
  });

  it('getRepairSummary delegates to ReportsService.advancedAnalytics and returns .repairs', async () => {
    const result = await service.getRepairSummary({});

    expect(result).toEqual({ completionRate: '1.00' });
  });

  it('getSupplierPerformance delegates to ReportsService.advancedAnalytics and returns .purchasing', async () => {
    const result = await service.getSupplierPerformance({});

    expect(result).toEqual({ suppliers: [] });
  });

  it('getReorderSuggestions delegates to StockService.findReorderSuggestions', async () => {
    await service.getReorderSuggestions({ limit: 200 });

    expect(findReorderSuggestions).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
  });
});
