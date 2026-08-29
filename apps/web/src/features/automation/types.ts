import type { NotificationType } from '@/features/notifications/types';

export type ConditionOperator = 'EQUALS' | 'NOT_EQUALS' | 'GREATER_THAN' | 'LESS_THAN';
export type AutomationActionType = 'NOTIFY';
export type UserRole = 'ADMIN' | 'MANAGER' | 'STAFF' | 'TECHNICIAN';

/** The trigger types that carry per-event context a condition can meaningfully match against. */
export const AUTOMATION_TRIGGER_TYPES: NotificationType[] = ['LOW_STOCK', 'OUT_OF_STOCK', 'ORDER_COMPLETED', 'PURCHASE_RECEIVED', 'REPAIR_READY'];

export interface AutomationCondition {
  field: string;
  operator: ConditionOperator;
  value: string;
}

export interface AutomationRule {
  id: string;
  name: string;
  triggerType: NotificationType;
  conditions: AutomationCondition[];
  actionType: AutomationActionType;
  actionRoles: UserRole[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
