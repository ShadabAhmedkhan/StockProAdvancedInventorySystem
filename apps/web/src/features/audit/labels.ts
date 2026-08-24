import type { AuditAction, AuditEntity } from './types';

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  CREATE: 'Create',
  UPDATE: 'Update',
  DELETE: 'Delete',
  LOGIN: 'Login',
  LOGIN_FAILED: 'Login failed',
  LOGOUT: 'Logout',
  ROLE_CHANGED: 'Role changed',
  STATUS_CHANGED: 'Status changed',
  STOCK_ADJUSTED: 'Stock adjusted',
  ORDER_COMPLETED: 'Order completed',
  ORDER_CANCELLED: 'Order cancelled',
  RETURN_APPROVED: 'Return approved',
  RETURN_COMPLETED: 'Return completed',
  REPAIR_STATUS_CHANGED: 'Repair status changed',
  PAYMENT_RECORDED: 'Payment recorded',
};

export const AUDIT_ENTITY_LABELS: Record<AuditEntity, string> = {
  AUTH: 'Auth',
  USER: 'User',
  CUSTOMER: 'Customer',
  SUPPLIER: 'Supplier',
  CATEGORY: 'Category',
  BRAND: 'Brand',
  PRODUCT: 'Product',
  INVENTORY: 'Inventory',
  ORDER: 'Order',
  REPAIR: 'Repair',
  RETURN: 'Return',
  EXPENSE: 'Expense',
  PAYMENT: 'Payment',
  SETTING: 'Setting',
};
