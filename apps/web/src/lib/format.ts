const currencyFormatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
const numberFormatter = new Intl.NumberFormat(undefined);
const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const shortDateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/** `money` is always a fixed two-decimal string, e.g. "129.99" - see `serialiseDecimalsAsFixedStrings` on the API. */
export function formatCurrency(money: string): string {
  return currencyFormatter.format(Number(money));
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatDateTime(value: string | null): string {
  return value === null ? '-' : dateFormatter.format(new Date(value));
}

export function formatShortDate(isoDate: string): string {
  return shortDateFormatter.format(new Date(`${isoDate}T00:00:00Z`));
}
