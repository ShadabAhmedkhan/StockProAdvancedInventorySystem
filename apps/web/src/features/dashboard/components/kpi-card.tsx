import type { LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}

const TONE_STYLES: Record<NonNullable<KpiCardProps['tone']>, string> = {
  default: 'bg-primary/10 text-primary',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/20 text-warning',
  danger: 'bg-danger/15 text-danger',
};

export function KpiCard({ label, value, hint, icon: Icon, tone = 'default' }: KpiCardProps): React.JSX.Element {
  return (
    <Card className="hover:shadow-sm">
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        {Icon !== undefined && (
          <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md', TONE_STYLES[tone])}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
        {hint !== undefined && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
