import type { NotificationType } from './types';

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  LOW_STOCK: 'Low stock',
  OUT_OF_STOCK: 'Out of stock',
  REPAIR_READY: 'Repair ready',
  REPAIR_OVERDUE: 'Repair overdue',
  ORDER_COMPLETED: 'Order completed',
  PURCHASE_RECEIVED: 'Purchase received',
  TRIAL_EXPIRING: 'Trial ending',
  SUBSCRIPTION_PAYMENT_FAILED: 'Payment failed',
};
