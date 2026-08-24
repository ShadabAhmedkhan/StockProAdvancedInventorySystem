import { apiClient, type PaginatedResult } from '@/lib/api-client';
import type { OrderDetail, OrderStatus, OrderSummary, Payment, PaymentMethod, PaymentStatus } from './types';

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const suffix = search.toString();
  return suffix === '' ? '' : `?${suffix}`;
}

export interface OrderListParams {
  page: number;
  search: string;
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
}

export interface OrderItemInput {
  productId: string;
  quantity: number;
  unitPrice?: string;
  discount?: string;
}

export interface CreateOrderInput {
  customerId?: string;
}

export interface UpdateOrderInput {
  customerId?: string;
  discount?: string;
  tax?: string;
  notes?: string;
}

export interface UpdateOrderItemInput {
  quantity?: number;
  unitPrice?: string;
  discount?: string;
}

export interface AddPaymentInput {
  method: PaymentMethod;
  amount: string;
  reference?: string;
  note?: string;
}

function withoutEmpty(input: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== '' && value !== undefined));
}

export const ordersApi = {
  list: ({ page, search, status, paymentStatus }: OrderListParams): Promise<PaginatedResult<OrderSummary>> =>
    apiClient.getPaginated<OrderSummary>(`/orders${query({ page, limit: 20, search, status, paymentStatus })}`),
  get: (id: string): Promise<OrderDetail> => apiClient.get<OrderDetail>(`/orders/${id}`),
  create: (input: CreateOrderInput): Promise<OrderDetail> => apiClient.post<OrderDetail>('/orders', withoutEmpty(input)),
  update: (id: string, input: UpdateOrderInput): Promise<OrderDetail> => apiClient.patch<OrderDetail>(`/orders/${id}`, withoutEmpty(input)),
  addItem: (id: string, input: OrderItemInput): Promise<OrderDetail> => apiClient.post<OrderDetail>(`/orders/${id}/items`, withoutEmpty(input)),
  updateItem: (id: string, itemId: string, input: UpdateOrderItemInput): Promise<OrderDetail> =>
    apiClient.patch<OrderDetail>(`/orders/${id}/items/${itemId}`, withoutEmpty(input)),
  removeItem: (id: string, itemId: string): Promise<OrderDetail> => apiClient.delete<OrderDetail>(`/orders/${id}/items/${itemId}`),
  confirm: (id: string): Promise<OrderDetail> => apiClient.post<OrderDetail>(`/orders/${id}/confirm`),
  complete: (id: string): Promise<OrderDetail> => apiClient.post<OrderDetail>(`/orders/${id}/complete`),
  cancel: (id: string): Promise<OrderDetail> => apiClient.post<OrderDetail>(`/orders/${id}/cancel`),
  payments: (id: string): Promise<Payment[]> => apiClient.get<Payment[]>(`/orders/${id}/payments`),
  addPayment: (id: string, input: AddPaymentInput): Promise<Payment> => apiClient.post<Payment>(`/orders/${id}/payments`, withoutEmpty(input)),
};
