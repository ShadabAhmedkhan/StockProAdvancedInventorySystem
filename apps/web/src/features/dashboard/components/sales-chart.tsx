import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency, formatShortDate } from '@/lib/format';
import type { SalesChartPoint } from '../types';

const CHART_HEIGHT = 160;
const BAR_GAP = 4;

/**
 * A dependency-free SVG bar chart. Fourteen points is small and fixed
 * (`CHART_DAYS` on the API), so a charting library would be a lot of weight
 * for something this simple.
 */
export function SalesChart({ points }: { points: SalesChartPoint[] }): React.JSX.Element {
  const revenues = points.map((point) => Number(point.revenue));
  const max = Math.max(...revenues, 1);
  const barWidth = points.length > 0 ? 100 / points.length : 0;
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales, last {points.length} days</CardTitle>
      </CardHeader>
      <CardContent>
        <svg viewBox={`0 0 100 ${CHART_HEIGHT}`} preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label="Daily revenue bar chart">
          {points.map((point, index) => {
            const revenue = revenues[index] ?? 0;
            const barHeight = max === 0 ? 0 : (revenue / max) * (CHART_HEIGHT - 8);
            return (
              <rect
                key={point.date}
                x={index * barWidth + BAR_GAP / 2}
                y={CHART_HEIGHT - barHeight}
                width={Math.max(barWidth - BAR_GAP, 1)}
                height={barHeight}
                className="fill-primary/70"
              >
                <title>
                  {formatShortDate(point.date)}: {formatCurrency(point.revenue)}
                </title>
              </rect>
            );
          })}
        </svg>
        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
          <span>{firstPoint !== undefined && formatShortDate(firstPoint.date)}</span>
          <span>{lastPoint !== undefined && formatShortDate(lastPoint.date)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
