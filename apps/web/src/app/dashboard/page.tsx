'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, DollarSign, Package, TrendingUp, Wallet, Wrench, Undo2 } from 'lucide-react';
import { KpiCard } from '@/features/dashboard/components/kpi-card';
import { RecentSales } from '@/features/dashboard/components/recent-sales';
import { RecentStockMovements } from '@/features/dashboard/components/recent-stock-movements';
import { RepairStatusBreakdown } from '@/features/dashboard/components/repair-status-breakdown';
import { SalesChart } from '@/features/dashboard/components/sales-chart';
import { fetchDashboardSummary } from '@/features/dashboard/api';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/error-message';
import { formatCurrency, formatNumber } from '@/lib/format';

export default function DashboardPage(): React.JSX.Element {
  const { user } = useAuth();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['dashboard-summary'], queryFn: fetchDashboardSummary });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Welcome back{user !== null ? `, ${user.firstName}` : ''}</h1>
        <p className="text-sm text-muted-foreground">Here is what is happening across the business today.</p>
      </div>

      {isLoading && (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-7 w-20" />
              <Skeleton className="mt-2 h-3 w-32" />
            </Card>
          ))}
        </section>
      )}

      {isError && (
        <Card className="border-danger/30 bg-danger/5 p-4 text-sm text-danger">{errorMessage(error)}</Card>
      )}

      {data !== undefined && (
        <>
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Sales today" value={formatCurrency(data.sales.today)} icon={DollarSign} />
            <KpiCard label="Sales this month" value={formatCurrency(data.sales.thisMonth)} icon={TrendingUp} />
            <KpiCard
              label="Gross revenue"
              value={formatCurrency(data.sales.grossRevenue)}
              hint={`${formatNumber(data.sales.totalOrders)} completed orders`}
              icon={DollarSign}
            />
            <KpiCard
              label="Net position"
              value={formatCurrency(data.finance.netPosition)}
              hint={`${formatCurrency(data.finance.expenses)} in expenses`}
              icon={Wallet}
              tone="success"
            />
            <KpiCard
              label="Inventory value"
              value={formatCurrency(data.inventory.inventoryValueAtRetail)}
              hint={`${formatNumber(data.inventory.totalUnits)} units across ${formatNumber(data.inventory.totalProducts)} products`}
              icon={Package}
            />
            <KpiCard
              label="Stock alerts"
              value={formatNumber(data.inventory.lowStockCount + data.inventory.outOfStockCount)}
              hint={`${formatNumber(data.inventory.outOfStockCount)} out of stock`}
              icon={AlertTriangle}
              tone={data.inventory.outOfStockCount > 0 ? 'danger' : 'warning'}
            />
            <KpiCard label="Active repairs" value={formatNumber(data.repairs.active)} hint={`${formatNumber(data.repairs.completed)} completed`} icon={Wrench} />
            <KpiCard
              label="Pending returns"
              value={formatNumber(data.returns.pending)}
              hint={`${formatNumber(data.customers.total)} customers`}
              icon={Undo2}
            />
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
