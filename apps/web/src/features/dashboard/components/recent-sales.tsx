import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency, formatDateTime } from '@/lib/format';
import type { RecentSale } from '../types';

export function RecentSales({ sales }: { sales: RecentSale[] }): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent sales</CardTitle>
      </CardHeader>
      <CardContent>
        {sales.length === 0 ? (
          <p className="text-sm text-muted-foreground">No completed orders yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Order</th>
                  <th className="pb-2 font-medium">Customer</th>
                  <th className="pb-2 font-medium">Completed</th>
                  <th className="pb-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id} className="border-t border-border">
                    <td className="py-2 font-medium">{sale.orderNumber}</td>
                    <td className="py-2 text-muted-foreground">{sale.customerName ?? 'Walk-in'}</td>
                    <td className="py-2 text-muted-foreground">{formatDateTime(sale.completedAt)}</td>
                    <td className="py-2 text-right tabular-nums">{formatCurrency(sale.total)}</td>
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
