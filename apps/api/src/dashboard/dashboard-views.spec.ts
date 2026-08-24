import { Prisma } from '../generated/prisma/client';
import { RepairStatus } from '../generated/prisma/enums';
import { chartStart, CHART_DAYS, fillChartDays, fillRepairStatuses } from './dashboard-views';

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

describe('chartStart', () => {
  it('lands on midnight UTC, days - 1 days before the end date', () => {
    const endingOn = new Date('2026-08-22T15:37:00.000Z');

    const start = chartStart(endingOn, 14);

    expect(start.toISOString()).toBe('2026-08-09T00:00:00.000Z');
  });
});

describe('fillChartDays', () => {
  it('fills every day in the window, not just the ones with rows', () => {
    const endingOn = new Date('2026-08-03T00:00:00.000Z');
    const rows = [{ date: new Date('2026-08-02T00:00:00.000Z'), revenue: decimal('40.00') }];

    const points = fillChartDays(rows, 3, endingOn);

    expect(points).toEqual([
      { date: '2026-08-01', revenue: decimal('0') },
      { date: '2026-08-02', revenue: decimal('40.00') },
      { date: '2026-08-03', revenue: decimal('0') },
    ]);
  });

  it('orders points oldest to newest, ending on the given date', () => {
    const endingOn = new Date('2026-08-22T00:00:00.000Z');

    const points = fillChartDays([], CHART_DAYS, endingOn);

    expect(points).toHaveLength(CHART_DAYS);
    expect(points[0]?.date).toBe('2026-08-09');
    expect(points.at(-1)?.date).toBe('2026-08-22');
  });
});

describe('fillRepairStatuses', () => {
  it('reports zero for a status nobody is currently in', () => {
    const distribution = fillRepairStatuses([{ status: RepairStatus.RECEIVED, _count: { _all: 3 } }]);

    expect(distribution[RepairStatus.RECEIVED]).toBe(3);
    expect(distribution[RepairStatus.DELIVERED]).toBe(0);
  });

  it('covers every declared status', () => {
    const distribution = fillRepairStatuses([]);

    expect(Object.keys(distribution)).toHaveLength(Object.values(RepairStatus).length);
  });
});
