'use client';

import { useQuery } from '@tanstack/react-query';
import { KpiCard } from '@/features/dashboard/components/kpi-card';
import { RecentSales } from '@/features/dashboard/components/recent-sales';
import { RecentStockMovements } from '@/features/dashboard/components/recent-stock-movements';
import { RepairStatusBreakdown } from '@/features/dashboard/components/repair-status-breakdown';
import { SalesChart } from '@/features/dashboard/components/sales-chart';
import { fetchDashboardSummary } from '@/features/dashboard/api';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/error-message';
import { formatCurrency, formatNumber } from '@/lib/format';

export default function DashboardPage(): React.JSX.Element {
  const { user } = useAuth();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['dashboard-summary'], queryFn: fetchDashboardSummary });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Welcome back{user !== null ? `, ${user.firstName}` : ''}</h1>
        <p className="text-sm text-muted-foreground">Here is what is happening across the business today.</p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading dashboard...</p>}

      {isError && <p className="text-sm text-red-600">{errorMessage(error)}</p>}

      {data !== undefined && (
        <>
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Sales today" value={formatCurrency(data.sales.today)} />
            <KpiCard label="Sales this month" value={formatCurrency(data.sales.thisMonth)} />
            <KpiCard label="Gross revenue" value={formatCurrency(data.sales.grossRevenue)} hint={`${formatNumber(data.sales.totalOrders)} completed orders`} />
            <KpiCard label="Net position" value={formatCurrency(data.finance.netPosition)} hint={`${formatCurrency(data.finance.expenses)} in expenses`} />
            <KpiCard
              label="Inventory value"
              value={formatCurrency(data.inventory.inventoryValueAtRetail)}
              hint={`${formatNumber(data.inventory.totalUnits)} units across ${formatNumber(data.inventory.totalProducts)} products`}
            />
            <KpiCard
              label="Stock alerts"
              value={formatNumber(data.inventory.lowStockCount + data.inventory.outOfStockCount)}
              hint={`${formatNumber(data.inventory.outOfStockCount)} out of stock`}
            />
            <KpiCard label="Active repairs" value={formatNumber(data.repairs.active)} hint={`${formatNumber(data.repairs.completed)} completed`} />
            <KpiCard label="Pending returns" value={formatNumber(data.returns.pending)} hint={`${formatNumber(data.customers.total)} customers`} />
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SalesChart points={data.salesChart} />
            <RepairStatusBreakdown statusDistribution={data.repairs.statusDistribution} />
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <RecentSales sales={data.recentSales} />
            <RecentStockMovements movements={data.recentStockMovements} />
          </section>
        </>
      )}
    </div>
  );
}
