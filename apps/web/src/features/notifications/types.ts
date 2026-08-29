export type NotificationType =
  | 'LOW_STOCK'
  | 'OUT_OF_STOCK'
  | 'REPAIR_READY'
  | 'REPAIR_OVERDUE'
  | 'ORDER_COMPLETED'
  | 'PURCHASE_RECEIVED'
  | 'TRIAL_EXPIRING'
  | 'SUBSCRIPTION_PAYMENT_FAILED';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}
