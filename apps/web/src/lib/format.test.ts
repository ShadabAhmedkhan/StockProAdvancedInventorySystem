import { describe, expect, it } from 'vitest';
import { formatCurrency, formatDateTime, formatNumber, formatShortDate } from './format';

describe('formatCurrency', () => {
  it('formats a fixed two-decimal money string as USD', () => {
    expect(formatCurrency('129.99')).toBe('$129.99');
  });

  it('formats zero', () => {
    expect(formatCurrency('0.00')).toBe('$0.00');
  });

  it('formats a negative amount', () => {
    expect(formatCurrency('-42.50')).toBe('-$42.50');
  });
});

describe('formatNumber', () => {
  it('adds thousands separators', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('formats zero', () => {
    expect(formatNumber(0)).toBe('0');
  });
});

describe('formatDateTime', () => {
  it('returns a dash for null', () => {
    expect(formatDateTime(null)).toBe('-');
  });

  it('formats an ISO timestamp', () => {
    expect(formatDateTime('2026-01-15T10:30:00Z')).not.toBe('-');
  });
});

describe('formatShortDate', () => {
  it('formats an ISO date as month + day', () => {
    const result = formatShortDate('2026-03-05');
    expect(result).toContain('5');
  });
});
