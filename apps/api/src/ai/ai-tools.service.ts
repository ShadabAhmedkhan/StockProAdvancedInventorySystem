import { Injectable } from '@nestjs/common';
import { FinanceService } from '../finance/finance.service';
import { ReportsService } from '../reports/reports.service';
import { StockQueryDto, StockStatusFilter } from '../stock/dto/stock-query.dto';
import { ReorderQueryDto } from '../stock/dto/reorder-query.dto';
import { StockService } from '../stock/stock.service';

/**
 * The permission-aware StockPro AI tool layer (Phase 42).
 *
 * Every method here is a thin, read-only wrapper around a service the rest of
 * the app already uses - `StockService`, `FinanceService`, `ReportsService`.
 * None of them accept or build a raw query: the model can only ever see what
 * one of these named tools chooses to return, which is what keeps it from
 * inventing or reaching past figures the app itself doesn't already trust.
 *
 * Tenant isolation and location scoping are inherited "for free": every
 * underlying service reads `getCurrentOrgId()` from the request's
 * `AsyncLocalStorage` context (the tenant Prisma extension) exactly as it
 * does for its own REST endpoints - this layer runs inside the same request,
 * so it can't see another organization's data no matter what a caller asks.
 * Location-level scoping, however, is only as granular as the underlying
 * reports/stock queries already are today - they aggregate per-organization,
 * not per assigned location - so a MANAGER restricted to one location still
 * sees whole-organization figures through these tools. That is an existing
 * limitation of the reused services, not something this layer relaxes.
 */
@Injectable()
export class AiToolsService {
  constructor(
    private readonly reports: ReportsService,
    private readonly stock: StockService,
    private readonly finance: FinanceService,
  ) {}

  async getSalesSummary(args: { from?: string; to?: string }) {
    const analytics = await this.reports.advancedAnalytics(analyticsArgs(args));
    return analytics.sales;
  }

  async getInventorySummary() {
    return this.stock.summary();
  }

  async getLowStock(args: { limit?: number }) {
    const query = Object.assign(new StockQueryDto(), {
      stockStatus: StockStatusFilter.LOW,
      sortBy: 'availableQuantity' as const,
      sortOrder: 'asc' as const,
      limit: clampLimit(args.limit, 20, 100),
    });
    return this.stock.findAll(query);
  }

  async getInventoryAging(args: { from?: string; to?: string; deadStockDays?: number }) {
    const analytics = await this.reports.advancedAnalytics(analyticsArgs(args, args.deadStockDays));
    return analytics.inventory;
  }

  async getTopProducts(args: { from?: string; to?: string; limit?: number }) {
    return this.reports.topProducts({
      from: args.from === undefined ? undefined : new Date(args.from),
      to: args.to === undefined ? undefined : new Date(args.to),
      limit: clampLimit(args.limit, 10, 50),
    });
  }

  /**
   * "Slow products" reuses the same dead-stock definition `advancedAnalytics`
   * already computes (in-stock, no SALE movement in `days`) rather than a new
   * raw query. That existing query only returns a count, not the product
   * list, so this tool answers with the count and says so - it does not
   * invent a per-product breakdown no existing service exposes.
   */
  async getSlowProducts(args: { from?: string; to?: string; days?: number }) {
    const days = args.days ?? 90;
    const analytics = await this.reports.advancedAnalytics(analyticsArgs(args, days));
    return {
      deadStockDays: days,
      deadStockCount: analytics.inventory.deadStockCount,
      note: 'Count only - no per-product listing is available from existing reporting queries for this window.',
    };
  }

  async getFinanceSummary(args: { from?: string; to?: string }) {
    return this.finance.summary(dateArgs(args));
  }

  async getRepairSummary(args: { from?: string; to?: string }) {
    const analytics = await this.reports.advancedAnalytics(analyticsArgs(args));
    return analytics.repairs;
  }

  async getSupplierPerformance(args: { from?: string; to?: string }) {
    const analytics = await this.reports.advancedAnalytics(analyticsArgs(args));
    return analytics.purchasing;
  }

  async getReorderSuggestions(args: { limit?: number }) {
    const query = Object.assign(new ReorderQueryDto(), { limit: clampLimit(args.limit, 20, 100) });
    return this.stock.findReorderSuggestions(query);
  }
}

function dateArgs(args: { from?: string; to?: string }): { from?: Date; to?: Date } {
  return {
    from: args.from === undefined ? undefined : new Date(args.from),
    to: args.to === undefined ? undefined : new Date(args.to),
  };
}

/** `AnalyticsQueryDto.deadStockDays` has no meaningful default when built by hand rather than through the validation pipe, so every direct call fixes it explicitly. */
function analyticsArgs(args: { from?: string; to?: string }, deadStockDays = 90): { from?: Date; to?: Date; deadStockDays: number } {
  return { ...dateArgs(args), deadStockDays };
}

function clampLimit(requested: number | undefined, fallback: number, max: number): number {
  if (requested === undefined || !Number.isInteger(requested) || requested < 1) {
    return fallback;
  }
  return Math.min(requested, max);
}
