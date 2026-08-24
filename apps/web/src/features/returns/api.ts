import { apiClient, type PaginatedResult } from '@/lib/api-client';
import type { Payment, PaymentMethod, ReturnDetail, ReturnReason, ReturnStatus, ReturnSummary } from './types';

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

function withoutEmpty(input: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== '' && value !== undefined));
}

export interface ReturnListParams {
  page: number;
  status?: ReturnStatus;
  reason?: ReturnReason;
  orderId?: string;
  customerId?: string;
}

export interface CreateReturnItemInput {
  orderItemId: string;
  quantity: number;
  restock?: boolean;
}

export interface CreateReturnInput {
  orderId: string;
  reason: ReturnReason;
  reasonNote?: string;
  items: CreateReturnItemInput[];
}

export interface UpdateReturnInput {
  reason?: ReturnReason;
  reasonNote?: string;
}

export interface UpdateReturnItemInput {
  quantity?: number;
  restock?: boolean;
}

export interface CompleteReturnInput {
  method: PaymentMethod;
  reference?: string;
  note?: string;
}

export const returnsApi = {
  list: ({ page, status, reason, orderId, customerId }: ReturnListParams): Promise<PaginatedResult<ReturnSummary>> =>
    apiClient.getPaginated<ReturnSummary>(`/returns${query({ page, limit: 20, status, reason, orderId, customerId })}`),
  get: (id: string): Promise<ReturnDetail> => apiClient.get<ReturnDetail>(`/returns/${id}`),
  create: (input: CreateReturnInput): Promise<ReturnDetail> => apiClient.post<ReturnDetail>('/returns', withoutEmpty(input)),
  update: (id: string, input: UpdateReturnInput): Promise<ReturnDetail> => apiClient.patch<ReturnDetail>(`/returns/${id}`, withoutEmpty(input)),
  addItem: (id: string, input: CreateReturnItemInput): Promise<ReturnDetail> => apiClient.post<ReturnDetail>(`/returns/${id}/items`, withoutEmpty(input)),
  updateItem: (id: string, itemId: string, input: UpdateReturnItemInput): Promise<ReturnDetail> =>
    apiClient.patch<ReturnDetail>(`/returns/${id}/items/${itemId}`, withoutEmpty(input)),
  removeItem: (id: string, itemId: string): Promise<ReturnDetail> => apiClient.delete<ReturnDetail>(`/returns/${id}/items/${itemId}`),
  approve: (id: string): Promise<ReturnDetail> => apiClient.post<ReturnDetail>(`/returns/${id}/approve`),
  reject: (id: string): Promise<ReturnDetail> => apiClient.post<ReturnDetail>(`/returns/${id}/reject`),
  complete: (id: string, input: CompleteReturnInput): Promise<ReturnDetail> => apiClient.post<ReturnDetail>(`/returns/${id}/complete`, withoutEmpty(input)),
  payments: (id: string): Promise<Payment[]> => apiClient.get<Payment[]>(`/returns/${id}/payments`),
};
