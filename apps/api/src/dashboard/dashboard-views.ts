import { Prisma } from '../generated/prisma/client';
import { RepairStatus } from '../generated/prisma/enums';

/** Rows the chart shows, so it never looks better than a fortnight ago. */
export const CHART_DAYS = 14;

/** How many rows a "recent activity" list carries. */
export const RECENT_LIMIT = 10;

const ZERO = new Prisma.Decimal(0);

export interface SalesChartPoint {
  date: string;
  revenue: Prisma.Decimal;
}

interface DailyRevenueRow {
  date: Date;
  revenue: Prisma.Decimal;
}

/**
 * Fills in the days a query returns nothing for.
 *
 * `GROUP BY` only produces a row for a day that actually sold something, and
 * a chart with gaps where an axis label should be reads as broken rather than
 * as a quiet day.
 */
export function fillChartDays(rows: readonly DailyRevenueRow[], days: number, endingOn: Date): SalesChartPoint[] {
  const byDate = new Map(rows.map((row) => [isoDate(row.date), row.revenue]));
  const points: SalesChartPoint[] = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(endingOn);
    date.setUTCDate(date.getUTCDate() - offset);
    const key = isoDate(date);
    points.push({ date: key, revenue: byDate.get(key) ?? ZERO });
  }

  return points;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Midnight UTC, `days - 1` days before `endingOn` - the chart's left edge. */
export function chartStart(endingOn: Date, days: number): Date {
  const start = new Date(endingOn);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

/** Every repair status, defaulted to zero, so a status nobody is in still appears. */
export function fillRepairStatuses(rows: readonly { status: RepairStatus; _count: { _all: number } }[]): Record<RepairStatus, number> {
  const counted = new Map(rows.map((row) => [row.status, row._count._all]));

  return Object.fromEntries(Object.values(RepairStatus).map((status) => [status, counted.get(status) ?? 0])) as Record<RepairStatus, number>;
}
