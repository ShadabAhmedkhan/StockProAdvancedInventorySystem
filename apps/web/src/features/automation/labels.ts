import { NOTIFICATION_TYPE_LABELS } from '@/features/notifications/labels';
import type { NotificationType } from '@/features/notifications/types';
import type { ConditionOperator } from './types';

export const AUTOMATION_TRIGGER_LABELS: Partial<Record<NotificationType, string>> = NOTIFICATION_TYPE_LABELS;

export const CONDITION_OPERATOR_LABELS: Record<ConditionOperator, string> = {
  EQUALS: 'equals',
  NOT_EQUALS: 'does not equal',
  GREATER_THAN: 'is greater than',
  LESS_THAN: 'is less than',
};

/** The context fields each trigger's condition can reference - matches what the backend's trigger sites actually pass. */
export const TRIGGER_FIELDS: Record<string, string[]> = {
  LOW_STOCK: ['sku', 'name', 'categoryName', 'quantity'],
  OUT_OF_STOCK: ['sku', 'name', 'categoryName', 'quantity'],
  ORDER_COMPLETED: ['orderNumber', 'total'],
  PURCHASE_RECEIVED: ['poNumber'],
  REPAIR_READY: ['repairNumber'],
};
