export type OrderStatus = 'DRAFT' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'REFUNDED';
export type PaymentMethod = 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'OTHER';

export interface OrderCustomer {
  id: string;
  customerCode: string;
  firstName: string;
  lastName: string;
  phone?: string;
}

export interface OrderCreatedBy {
  id: string;
  firstName: string;
  lastName: string;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  customerId: string | null;
  status: OrderStatus;
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  paidAmount: string;
  outstanding: string;
  paymentStatus: PaymentStatus;
  notes: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  customer: OrderCustomer | null;
  createdBy: OrderCreatedBy;
  _count: { items: number };
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  unitPrice: string;
  discount: string;
  total: string;
  createdAt: string;
  updatedAt: string;
  product: { id: string; sku: string; name: string };
}

export interface Payment {
  id: string;
  paymentNumber: string;
  method: PaymentMethod;
  amount: string;
  reference: string | null;
  note: string | null;
  paidAt: string;
  createdAt: string;
}

export interface OrderDetail extends Omit<OrderSummary, 'customer' | '_count'> {
  customer: OrderCustomer | null;
  items: OrderItem[];
  payments: Payment[];
}
