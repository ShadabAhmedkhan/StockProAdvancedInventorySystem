import type { StockStatus } from './types';

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  OK: 'In stock',
  LOW: 'Low stock',
  OUT: 'Out of stock',
};

export const STOCK_STATUS_CLASSES: Record<StockStatus, string> = {
  OK: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  LOW: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  OUT: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
};

/** Same rule the API's `stockStatus` column applies, for the product catalog view which only has the raw quantity. */
export function stockStatusFor(quantity: number, minimumStock: number): StockStatus {
  if (quantity <= 0) {
    return 'OUT';
  }
  return quantity <= minimumStock ? 'LOW' : 'OK';
}
