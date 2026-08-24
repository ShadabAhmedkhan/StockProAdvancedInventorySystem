import type { Payment, PaymentMethod } from '@/features/orders/types';

export type { Payment, PaymentMethod };

export type ReturnStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED';
export type ReturnReason = 'DAMAGED' | 'DEFECTIVE' | 'WRONG_ITEM' | 'NOT_AS_DESCRIBED' | 'CHANGED_MIND' | 'WARRANTY' | 'OTHER';

export interface ReturnOrderRef {
  id: string;
  orderNumber: string;
  total: string;
  paidAmount: string;
  completedAt?: string | null;
}

export interface ReturnCustomerRef {
  id: string;
  customerCode: string;
  firstName: string;
  lastName: string;
  phone?: string;
}

export interface ReturnCreatedBy {
  id: string;
  firstName: string;
  lastName: string;
}

export interface ReturnSummary {
  id: string;
  returnNumber: string;
  orderId: string;
  customerId: string | null;
  reason: ReturnReason;
  reasonNote: string | null;
  status: ReturnStatus;
  refundAmount: string;
  createdById: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  order: ReturnOrderRef;
  customer: ReturnCustomerRef | null;
  createdBy: ReturnCreatedBy;
  paidBackAmount: string;
  outstandingCredit: string;
  _count: { items: number };
}

export interface ReturnItem {
  id: string;
  returnId: string;
  orderItemId: string;
  productId: string;
  quantity: number;
  unitPrice: string;
  total: string;
  restock: boolean;
  createdAt: string;
  updatedAt: string;
  product: { id: string; sku: string; name: string };
  orderItem: { id: string; quantity: number; unitPrice: string; total: string };
}

export interface ReturnDetail extends Omit<ReturnSummary, '_count'> {
  items: ReturnItem[];
  payments: Payment[];
}
