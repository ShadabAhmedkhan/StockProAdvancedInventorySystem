'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { reportsApi } from '@/features/reports/api';
import type { SalesReportPeriod } from '@/features/reports/types';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/lib/error-message';
import { formatCurrency, formatNumber, formatShortDate } from '@/lib/format';

const TABS = ['Sales', 'Inventory', 'Top products'] as const;
type Tab = (typeof TABS)[number];

const PERIOD_LABELS: Record<SalesReportPeriod, string> = { day: 'Day', week: 'Week', month: 'Month' };
const PERIODS: SalesReportPeriod[] = ['day', 'week', 'month'];

export default function ReportsPage(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('Sales');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground">Revenue, stock valuation and top sellers.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          From
          <Input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
            className="w-40"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          To
          <Input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
            }}
            className="w-40"
          />
        </label>
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setTab(value);
            }}
            className={cn(
              'border-b-2 px-3 py-2 text-sm',
              tab === value ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {value}
          </button>
        ))}
      </div>

      {tab === 'Sales' && <SalesTab from={from} to={to} />}
      {tab === 'Inventory' && <InventoryTab />}
      {tab === 'Top products' && <TopProductsTab from={from} to={to} />}
    </div>
  );
}

function SalesTab({ from, to }: { from: string; to: string }): React.JSX.Element {
  const [groupBy, setGroupBy] = useState<SalesReportPeriod>('day');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['reports-sales', from, to, groupBy],
    queryFn: () => reportsApi.sales({ from: from === '' ? undefined : from, to: to === '' ? undefined : to, groupBy }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Select
          value={groupBy}
          onChange={(event) => {
            setGroupBy(event.target.value as SalesReportPeriod);
          }}
          className="max-w-32"
        >
          {PERIODS.map((value) => (
            <option key={value} value={value}>
              {PERIOD_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {isError && <p className="text-sm text-red-600">{errorMessage(error)}</p>}

      {data !== undefined && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Orders" value={formatNumber(data.totals.orders)} />
            <KpiCard label="Subtotal" value={formatCurrency(data.totals.subtotal)} />
            <KpiCard label="Discount" value={formatCurrency(data.totals.discount)} />
            <KpiCard label="Total revenue" value={formatCurrency(data.totals.total)} />
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="p-3 font-medium">Period</th>
                      <th className="p-3 text-right font-medium">Orders</th>
                      <th className="p-3 text-right font-medium">Subtotal</th>
                      <th className="p-3 text-right font-medium">Discount</th>
                      <th className="p-3 text-right font-medium">Tax</th>
                      <th className="p-3 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.points.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-4 text-center text-muted-foreground">
                          No completed orders in this period.
                        </td>
                      </tr>
                    )}
                    {data.points.map((point) => (
                      <tr key={point.period} className="border-b border-border last:border-0">
                        <td className="p-3">{formatShortDate(point.period)}</td>
                        <td className="p-3 text-right tabular-nums">{formatNumber(point.orders)}</td>
                        <td className="p-3 text-right tabular-nums">{formatCurrency(point.subtotal)}</td>
                        <td className="p-3 text-right tabular-nums">{formatCurrency(point.discount)}</td>
                        <td className="p-3 text-right tabular-nums">{formatCurrency(point.tax)}</td>
                        <td className="p-3 text-right tabular-nums">{formatCurrency(point.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function InventoryTab(): React.JSX.Element {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['reports-inventory'], queryFn: reportsApi.inventory });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (isError || data === undefined) return <p className="text-sm text-red-600">{errorMessage(error)}</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Units on hand" value={formatNumber(data.totals.totalUnits)} hint={`${formatNumber(data.totals.totalProducts)} products`} />
        <KpiCard label="Value at cost" value={formatCurrency(data.totals.inventoryValueAtCost)} />
        <KpiCard label="Value at retail" value={formatCurrency(data.totals.inventoryValueAtRetail)} />
        <KpiCard
          label="Stock alerts"
          value={formatNumber(data.totals.lowStockCount + data.totals.outOfStockCount)}
          hint={`${formatNumber(data.totals.outOfStockCount)} out of stock`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By category</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="p-3 font-medium">Category</th>
                  <th className="p-3 text-right font-medium">Products</th>
                  <th className="p-3 text-right font-medium">Units</th>
                  <th className="p-3 text-right font-medium">Value at cost</th>
                  <th className="p-3 text-right font-medium">Value at retail</th>
                  <th className="p-3 text-right font-medium">Low stock</th>
                  <th className="p-3 text-right font-medium">Out of stock</th>
                </tr>
              </thead>
              <tbody>
                {data.categories.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-4 text-center text-muted-foreground">
                      No categories found.
                    </td>
                  </tr>
                )}
                {data.categories.map((category) => (
                  <tr key={category.categoryId} className="border-b border-border last:border-0">
                    <td className="p-3">{category.categoryName}</td>
                    <td className="p-3 text-right tabular-nums">{formatNumber(category.productCount)}</td>
                    <td className="p-3 text-right tabular-nums">{formatNumber(category.totalUnits)}</td>
                    <td className="p-3 text-right tabular-nums">{formatCurrency(category.valueAtCost)}</td>
                    <td className="p-3 text-right tabular-nums">{formatCurrency(category.valueAtRetail)}</td>
                    <td className="p-3 text-right tabular-nums">{formatNumber(category.lowStockCount)}</td>
                    <td className="p-3 text-right tabular-nums">{formatNumber(category.outOfStockCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TopProductsTab({ from, to }: { from: string; to: string }): React.JSX.Element {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['reports-top-products', from, to],
    queryFn: () => reportsApi.topProducts({ from: from === '' ? undefined : from, to: to === '' ? undefined : to }),
  });

  return (
    <Card>
      <CardContent className="p-0">
        {isLoading && <p className="p-4 text-sm text-muted-foreground">Loading...</p>}
        {isError && <p className="p-4 text-sm text-red-600">{errorMessage(error)}</p>}
        {data !== undefined && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="p-3 font-medium">#</th>
                  <th className="p-3 font-medium">Product</th>
                  <th className="p-3 font-medium">SKU</th>
                  <th className="p-3 text-right font-medium">Units sold</th>
                  <th className="p-3 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-muted-foreground">
                      No sales in this period.
                    </td>
                  </tr>
                )}
                {data.map((product, index) => (
                  <tr key={product.productId} className="border-b border-border last:border-0">
                    <td className="p-3 text-muted-foreground">{index + 1}</td>
                    <td className="p-3">{product.name}</td>
                    <td className="p-3 text-muted-foreground">{product.sku}</td>
                    <td className="p-3 text-right tabular-nums">{formatNumber(product.quantitySold)}</td>
                    <td className="p-3 text-right tabular-nums">{formatCurrency(product.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {hint !== undefined && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
