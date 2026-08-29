'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PdfDownloadButton } from '@/components/pdf-download-button';
import { Select } from '@/components/ui/select';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { reportsApi } from '@/features/reports/api';
import type { SalesReportPeriod } from '@/features/reports/types';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/lib/error-message';
import { formatCurrency, formatNumber, formatShortDate } from '@/lib/format';
import { exportTableToPdf } from '@/lib/pdf-export';

const TABS = ['Sales', 'Inventory', 'Top products', 'Analytics'] as const;
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
      {tab === 'Analytics' && <AnalyticsTab from={from} to={to} />}
    </div>
  );
}

function AnalyticsTab({ from, to }: { from: string; to: string }): React.JSX.Element {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['reports-analytics', from, to],
    queryFn: () => reportsApi.analytics({ from: from === '' ? undefined : from, to: to === '' ? undefined : to }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (isError || data === undefined) return <p className="text-sm text-danger">{errorMessage(error)}</p>;

  const { sales, inventory, purchasing, repairs, finance } = data;

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Sales</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Orders" value={formatNumber(sales.orderCount)} />
          <KpiCard label="Revenue" value={formatCurrency(sales.revenue)} />
          <KpiCard label="Gross profit" value={formatCurrency(sales.grossProfit)} hint={`${(Number(sales.margin) * 100).toFixed(0)}% margin`} />
          <KpiCard label="Avg order value" value={formatCurrency(sales.averageOrderValue)} />
          <KpiCard label="Discount rate" value={`${(Number(sales.discountRate) * 100).toFixed(1)}%`} />
          <KpiCard label="Return rate" value={`${(Number(sales.returnRate) * 100).toFixed(1)}%`} />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Inventory</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Stock turnover" value={inventory.stockTurnover ?? 'N/A'} />
          <KpiCard label="Dead stock (products)" value={formatNumber(inventory.deadStockCount)} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Aging</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="p-3 font-medium">Bucket</th>
                    <th className="p-3 text-right font-medium">Products</th>
                    <th className="p-3 text-right font-medium">Value at cost</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.aging.map((row) => (
                    <tr key={row.bucket} className="border-b border-border last:border-0">
                      <td className="p-3">{row.bucket}</td>
                      <td className="p-3 text-right tabular-nums">{formatNumber(row.productCount)}</td>
                      <td className="p-3 text-right tabular-nums">{formatCurrency(row.valueAtCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Purchasing</h2>
        <Card>
          <CardHeader>
            <CardTitle>Supplier performance</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="p-3 font-medium">Supplier</th>
                    <th className="p-3 text-right font-medium">Orders</th>
                    <th className="p-3 text-right font-medium">Total spend</th>
                    <th className="p-3 text-right font-medium">Avg lead time</th>
                    <th className="p-3 text-right font-medium">On-time rate</th>
                  </tr>
                </thead>
                <tbody>
                  {purchasing.suppliers.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-muted-foreground">
                        No purchase orders in this period.
                      </td>
                    </tr>
                  )}
                  {purchasing.suppliers.map((row) => (
                    <tr key={row.supplierId} className="border-b border-border last:border-0">
                      <td className="p-3">{row.supplierName}</td>
                      <td className="p-3 text-right tabular-nums">{formatNumber(row.orderCount)}</td>
                      <td className="p-3 text-right tabular-nums">{formatCurrency(row.totalSpend)}</td>
                      <td className="p-3 text-right tabular-nums">{row.avgLeadTimeDays === null ? 'N/A' : `${row.avgLeadTimeDays.toFixed(1)}d`}</td>
                      <td className="p-3 text-right tabular-nums">{row.onTimeRate === null ? 'N/A' : `${(Number(row.onTimeRate) * 100).toFixed(0)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Repairs</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Completion rate" value={`${(Number(repairs.completionRate) * 100).toFixed(0)}%`} />
          <KpiCard label="Avg turnaround" value={repairs.avgTurnaroundDays === null ? 'N/A' : `${Number(repairs.avgTurnaroundDays).toFixed(1)}d`} />
          <KpiCard label="Repair revenue" value={formatCurrency(repairs.repairRevenue)} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Technician workload</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="p-3 font-medium">Technician</th>
                    <th className="p-3 text-right font-medium">Active</th>
                    <th className="p-3 text-right font-medium">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {repairs.technicianWorkload.length === 0 && (
                    <tr>
                      <td colSpan={3} className="p-4 text-center text-muted-foreground">
                        No technicians found.
                      </td>
                    </tr>
                  )}
                  {repairs.technicianWorkload.map((row) => (
                    <tr key={row.technicianId} className="border-b border-border last:border-0">
                      <td className="p-3">{row.technicianName}</td>
                      <td className="p-3 text-right tabular-nums">{formatNumber(row.activeCount)}</td>
                      <td className="p-3 text-right tabular-nums">{formatNumber(row.completedCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Finance</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Net revenue" value={formatCurrency(finance.netRevenue)} />
          <KpiCard label="Net position" value={formatCurrency(finance.netPosition)} />
          <KpiCard label="Refunds" value={formatCurrency(finance.refunds)} />
          <KpiCard label="Expenses" value={formatCurrency(finance.expenses.total)} />
        </div>
      </section>
    </div>
  );
}

function SalesTab({ from, to }: { from: string; to: string }): React.JSX.Element {
  const [groupBy, setGroupBy] = useState<SalesReportPeriod>('day');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['reports-sales', from, to, groupBy],
    queryFn: () => reportsApi.sales({ from: from === '' ? undefined : from, to: to === '' ? undefined : to, groupBy }),
  });

  function handleDownload(): void {
    if (data === undefined) return;
    exportTableToPdf({
      title: 'Sales report',
      subtitle: `Grouped by ${PERIOD_LABELS[groupBy].toLowerCase()}`,
      range: from === '' && to === '' ? 'All time' : `${from === '' ? 'Start' : from} to ${to === '' ? 'now' : to}`,
      summary: [
        { label: 'Orders', value: formatNumber(data.totals.orders) },
        { label: 'Subtotal', value: formatCurrency(data.totals.subtotal) },
        { label: 'Discount', value: formatCurrency(data.totals.discount) },
        { label: 'Total revenue', value: formatCurrency(data.totals.total) },
      ],
      columns: [
        { header: 'Period' },
        { header: 'Orders', align: 'right' },
        { header: 'Subtotal', align: 'right' },
        { header: 'Discount', align: 'right' },
        { header: 'Tax', align: 'right' },
        { header: 'Total', align: 'right' },
      ],
      rows: data.points.map((point) => [
        formatShortDate(point.period),
        formatNumber(point.orders),
        formatCurrency(point.subtotal),
        formatCurrency(point.discount),
        formatCurrency(point.tax),
        formatCurrency(point.total),
      ]),
      filename: `sales-report-${new Date().toISOString().slice(0, 10)}.pdf`,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <PdfDownloadButton onDownload={handleDownload} disabled={data === undefined} />
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
      {isError && <p className="text-sm text-danger">{errorMessage(error)}</p>}

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
  if (isError || data === undefined) return <p className="text-sm text-danger">{errorMessage(error)}</p>;

  function handleDownload(): void {
    if (data === undefined) return;
    exportTableToPdf({
      title: 'Inventory valuation report',
      subtitle: 'Stock valued by category',
      summary: [
        { label: 'Products', value: formatNumber(data.totals.totalProducts) },
        { label: 'Units on hand', value: formatNumber(data.totals.totalUnits) },
        { label: 'Value at cost', value: formatCurrency(data.totals.inventoryValueAtCost) },
        { label: 'Value at retail', value: formatCurrency(data.totals.inventoryValueAtRetail) },
      ],
      columns: [
        { header: 'Category' },
        { header: 'Products', align: 'right' },
        { header: 'Units', align: 'right' },
        { header: 'Value at cost', align: 'right' },
        { header: 'Value at retail', align: 'right' },
        { header: 'Low stock', align: 'right' },
        { header: 'Out of stock', align: 'right' },
      ],
      rows: data.categories.map((category) => [
        category.categoryName,
        formatNumber(category.productCount),
        formatNumber(category.totalUnits),
        formatCurrency(category.valueAtCost),
        formatCurrency(category.valueAtRetail),
        formatNumber(category.lowStockCount),
        formatNumber(category.outOfStockCount),
      ]),
      filename: `inventory-report-${new Date().toISOString().slice(0, 10)}.pdf`,
    });
  }

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
          <PdfDownloadButton onDownload={handleDownload} />
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

  function handleDownload(): void {
    if (data === undefined) return;
    exportTableToPdf({
      title: 'Top products report',
      subtitle: 'Best sellers by revenue',
      range: from === '' && to === '' ? 'All time' : `${from === '' ? 'Start' : from} to ${to === '' ? 'now' : to}`,
      columns: [
        { header: '#', align: 'right' },
        { header: 'Product' },
        { header: 'SKU' },
        { header: 'Units sold', align: 'right' },
        { header: 'Revenue', align: 'right' },
      ],
      rows: data.map((product, index) => [index + 1, product.name, product.sku, formatNumber(product.quantitySold), formatCurrency(product.revenue)]),
      filename: `top-products-report-${new Date().toISOString().slice(0, 10)}.pdf`,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top products</CardTitle>
        <PdfDownloadButton onDownload={handleDownload} disabled={data === undefined} />
      </CardHeader>
      <CardContent className="p-0">
        {isLoading && <TableSkeleton />}
        {isError && <p className="p-4 text-sm text-danger">{errorMessage(error)}</p>}
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
