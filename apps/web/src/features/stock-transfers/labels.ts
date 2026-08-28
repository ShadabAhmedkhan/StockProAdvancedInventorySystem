import type { StockTransferStatus } from './types';

export const STOCK_TRANSFER_STATUS_LABELS: Record<StockTransferStatus, string> = {
  DRAFT: 'Draft',
  REQUESTED: 'Requested',
  APPROVED: 'Approved',
  IN_TRANSIT: 'In transit',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const STOCK_TRANSFER_STATUS_CLASSES: Record<StockTransferStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  REQUESTED: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  APPROVED: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  IN_TRANSIT: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  COMPLETED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
};
