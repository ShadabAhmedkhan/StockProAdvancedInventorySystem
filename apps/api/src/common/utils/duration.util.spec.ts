import { parseDuration } from './duration.util';

describe('parseDuration', () => {
  it.each([
    ['30s', 30_000],
    ['15m', 900_000],
    ['1h', 3_600_000],
    ['24h', 86_400_000],
    ['7d', 604_800_000],
    ['0s', 0],
  ])('converts %s to %d ms', (value: string, expected: number) => {
    expect(parseDuration(value)).toBe(expected);
  });

  it.each([['15'], ['m'], ['15 m'], ['15minutes'], ['-5m'], ['1.5h'], ['15M'], ['']])('rejects %p', (value: string) => {
    expect(() => parseDuration(value)).toThrow(/Invalid duration/);
  });
});
