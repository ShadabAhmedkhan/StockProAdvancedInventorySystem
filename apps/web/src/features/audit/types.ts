export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'ROLE_CHANGED'
  | 'STATUS_CHANGED'
  | 'STOCK_ADJUSTED'
  | 'ORDER_COMPLETED'
  | 'ORDER_CANCELLED'
  | 'RETURN_APPROVED'
  | 'RETURN_COMPLETED'
  | 'REPAIR_STATUS_CHANGED'
  | 'PAYMENT_RECORDED';

export type AuditEntity =
  | 'AUTH'
  | 'USER'
  | 'CUSTOMER'
  | 'SUPPLIER'
  | 'CATEGORY'
  | 'BRAND'
  | 'PRODUCT'
  | 'INVENTORY'
  | 'ORDER'
  | 'REPAIR'
  | 'RETURN'
  | 'EXPENSE'
  | 'PAYMENT'
  | 'SETTING';

export interface AuditActor {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface AuditLog {
  id: string;
  userId: string | null;
  action: AuditAction;
  entity: AuditEntity;
  entityId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  user: AuditActor | null;
}
