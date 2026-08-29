import type { StockCountStatus } from './types';

export const STOCK_COUNT_STATUS_LABELS: Record<StockCountStatus, string> = {
  DRAFT: 'Draft',
  COUNTING: 'Counting',
  REVIEW: 'In review',
  APPROVED: 'Approved',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const STOCK_COUNT_STATUS_CLASSES: Record<StockCountStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300',
  COUNTING: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  REVIEW: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  APPROVED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  COMPLETED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
};
