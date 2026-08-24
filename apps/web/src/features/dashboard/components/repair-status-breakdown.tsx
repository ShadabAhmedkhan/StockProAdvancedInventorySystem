import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { REPAIR_STATUS_LABELS } from '../labels';
import type { RepairStatus } from '../types';

export function RepairStatusBreakdown({ statusDistribution }: { statusDistribution: Record<RepairStatus, number> }): React.JSX.Element {
  const entries = Object.entries(statusDistribution) as [RepairStatus, number][];
  const max = Math.max(...entries.map(([, count]) => count), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Repairs by status</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {entries.map(([status, count]) => (
          <div key={status} className="flex items-center gap-3 text-sm">
            <span className="w-32 shrink-0 text-muted-foreground">{REPAIR_STATUS_LABELS[status]}</span>
            <div className="h-2 flex-1 rounded-full bg-muted">
              <div className="h-2 rounded-full bg-primary" style={{ width: `${String((count / max) * 100)}%` }} />
            </div>
            <span className="w-6 shrink-0 text-right tabular-nums">{count}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
