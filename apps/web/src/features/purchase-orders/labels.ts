import type { PurchaseOrderStatus } from './types';

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Draft',
  APPROVED: 'Approved',
  ORDERED: 'Ordered',
  PARTIALLY_RECEIVED: 'Partially received',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
};

export const PURCHASE_ORDER_STATUS_CLASSES: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  APPROVED: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  ORDERED: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  PARTIALLY_RECEIVED: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  RECEIVED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
};
