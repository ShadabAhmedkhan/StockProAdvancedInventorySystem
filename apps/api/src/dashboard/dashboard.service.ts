import { Injectable } from '@nestjs/common';
import { FinanceService } from '../finance/finance.service';
import { Prisma } from '../generated/prisma/client';
import { OrderStatus, RepairStatus, ReturnStatus, TransactionType } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { OPEN_REPAIR_STATUSES, PAYABLE_REPAIR_STATUSES } from '../repairs/repair-status';
import type { MovementWithContext } from '../stock/stock.service';
import { StockService, type StockSummary } from '../stock/stock.service';
import { chartStart, CHART_DAYS, fillChartDays, fillRepairStatuses, RECENT_LIMIT, type SalesChartPoint } from './dashboard-views';

const ZERO = new Prisma.Decimal(0);

export interface RecentSale {
  id: string;
  orderNumber: string;
  customerName: string | null;
  total: Prisma.Decimal;
  completedAt: Date | null;
}

export interface DashboardSummary {
  sales: {
    /** Completed orders, all time - a count, not a money figure. */
    totalOrders: number;
    today: Prisma.Decimal;
    thisMonth: Prisma.Decimal;
    /** All income ever recorded in the ledger: sales, repair payments and other income. */
    grossRevenue: Prisma.Decimal;
  };
  finance: {
    expenses: Prisma.Decimal;
    netPosition: Prisma.Decimal;
  };
  inventory: StockSummary;
  repairs: {
    active: number;
    completed: number;
    statusDistribution: Record<RepairStatus, number>;
  };
  returns: {
    pending: number;
  };
  customers: {
    total: number;
  };
  recentSales: RecentSale[];
  recentStockMovements: MovementWithContext[];
  salesChart: SalesChartPoint[];
}

/**
 * The at-a-glance view. Every figure here is either counted directly or
 * reused from the module that owns it - `FinanceService.summary()` for
 * money, `StockService` for inventory - rather than re-derived, so the
 * dashboard can never disagree with the page a figure came from.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financeService: FinanceService,
    private readonly stockService: StockService,
  ) {}

  async summary(): Promise<DashboardSummary> {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setUTCHours(0, 0, 0, 0);
    const startOfMonth = new Date(Date.UTC(startOfToday.getUTCFullYear(), startOfToday.getUTCMonth(), 1));
    const chartSince = chartStart(now, CHART_DAYS);

    const [
      finance,
      salesToday,
      salesThisMonth,
      totalOrders,
      inventory,
      activeRepairs,
      completedRepairs,
      repairsByStatus,
      pendingReturns,
      totalCustomers,
      recentSales,
      recentMovements,
      chartRows,
    ] = await Promise.all([
      this.financeService.summary({}),
      this.salesTotal(startOfToday, now),
      this.salesTotal(startOfMonth, now),
      this.prisma.order.count({ where: { status: OrderStatus.COMPLETED } }),
      this.stockService.summary(),
      this.prisma.repair.count({ where: { status: { in: [...OPEN_REPAIR_STATUSES] } } }),
      this.prisma.repair.count({ where: { status: { in: [...PAYABLE_REPAIR_STATUSES] } } }),
      this.prisma.repair.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.return.count({ where: { status: ReturnStatus.PENDING } }),
      this.prisma.customer.count({ where: { deletedAt: null } }),
      this.recentSales(),
      this.stockService.findMovements({ page: 1, limit: RECENT_LIMIT, sortBy: 'createdAt', sortOrder: 'desc' }),
      this.prisma.$queryRaw<{ date: Date; revenue: Prisma.Decimal }[]>`
          SELECT date_trunc('day', "occurredAt")::date AS "date", COALESCE(SUM("amount"), 0)::numeric(14, 2) AS "revenue"
          FROM "FinancialTransaction"
          WHERE "type" = 'SALE'::"TransactionType" AND "occurredAt" >= ${chartSince}
          GROUP BY 1
          ORDER BY 1 ASC
        `,
    ]);

    return {
      sales: { totalOrders, today: salesToday, thisMonth: salesThisMonth, grossRevenue: finance.income.total },
      finance: { expenses: finance.expenses.total, netPosition: finance.netPosition },
      inventory,
      repairs: { active: activeRepairs, completed: completedRepairs, statusDistribution: fillRepairStatuses(repairsByStatus) },
      returns: { pending: pendingReturns },
      customers: { total: totalCustomers },
      recentSales,
      recentStockMovements: recentMovements.items,
      salesChart: fillChartDays(chartRows, CHART_DAYS, now),
    };
  }

  private async salesTotal(from: Date, to: Date): Promise<Prisma.Decimal> {
    const result = await this.prisma.financialTransaction.aggregate({
      where: { type: TransactionType.SALE, occurredAt: { gte: from, lte: to } },
      _sum: { amount: true },
    });

    return result._sum.amount ?? ZERO;
  }

  private async recentSales(): Promise<RecentSale[]> {
    const orders = await this.prisma.order.findMany({
      where: { status: OrderStatus.COMPLETED },
      orderBy: { completedAt: 'desc' },
      take: RECENT_LIMIT,
      select: { id: true, orderNumber: true, total: true, completedAt: true, customer: { select: { firstName: true, lastName: true } } },
    });

    return orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      customerName: order.customer === null ? null : `${order.customer.firstName} ${order.customer.lastName}`,
      total: order.total,
      completedAt: order.completedAt,
    }));
  }
}
