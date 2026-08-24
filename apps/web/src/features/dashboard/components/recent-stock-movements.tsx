import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import { isInboundMovement, STOCK_MOVEMENT_LABELS } from '../labels';
import type { StockMovement } from '../types';

export function RecentStockMovements({ movements }: { movements: StockMovement[] }): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent stock movements</CardTitle>
      </CardHeader>
      <CardContent>
        {movements.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stock movements yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {movements.map((movement) => {
              const inbound = isInboundMovement(movement.type);
              return (
                <li key={movement.id} className="flex items-center justify-between gap-3 border-t border-border pt-2 first:border-t-0 first:pt-0">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{movement.product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {STOCK_MOVEMENT_LABELS[movement.type]} &middot; {formatDateTime(movement.createdAt)}
                    </p>
                  </div>
                  <span className={cn('shrink-0 tabular-nums', inbound ? 'text-emerald-600' : 'text-red-600')}>
                    {inbound ? '+' : '-'}
                    {Math.abs(movement.quantity)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
