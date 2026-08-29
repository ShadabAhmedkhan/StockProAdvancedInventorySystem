import { createEntityApi } from '@/components/entity-crud/api-factory';
import { apiClient, type PaginatedResult } from '@/lib/api-client';
import type { OrderSummary } from '@/features/orders/types';
import type { RepairSummary } from '@/features/repairs/types';
import type {
  Customer,
  CreateCustomerAddressInput,
  CustomerAddress,
  CustomerLifetimeValue,
  CustomerNote,
  CustomerOutstanding,
  CustomerTimelineEntry,
  UpdateCustomerAddressInput,
} from './types';

export const customersApi = {
  ...createEntityApi<Customer>('/customers'),
  get: (id: string): Promise<Customer> => apiClient.get<Customer>(`/customers/${id}`),
  updateTags: (id: string, tags: string[]): Promise<Customer> => apiClient.patch<Customer>(`/customers/${id}`, { tags }),
  purchaseHistory: (id: string, page: number): Promise<PaginatedResult<OrderSummary>> =>
    apiClient.getPaginated<OrderSummary>(`/customers/${id}/purchase-history?page=${page}`),
  repairHistory: (id: string, page: number): Promise<PaginatedResult<RepairSummary>> =>
    apiClient.getPaginated<RepairSummary>(`/customers/${id}/repair-history?page=${page}`),
  outstanding: (id: string): Promise<CustomerOutstanding> => apiClient.get<CustomerOutstanding>(`/customers/${id}/outstanding`),
  lifetimeValue: (id: string): Promise<CustomerLifetimeValue> => apiClient.get<CustomerLifetimeValue>(`/customers/${id}/lifetime-value`),
  timeline: (id: string): Promise<CustomerTimelineEntry[]> => apiClient.get<CustomerTimelineEntry[]>(`/customers/${id}/timeline`),
  notes: (id: string): Promise<CustomerNote[]> => apiClient.get<CustomerNote[]>(`/customers/${id}/notes`),
  addNote: (id: string, body: string): Promise<CustomerNote> => apiClient.post<CustomerNote>(`/customers/${id}/notes`, { body }),
  addresses: (id: string): Promise<CustomerAddress[]> => apiClient.get<CustomerAddress[]>(`/customers/${id}/addresses`),
  addAddress: (id: string, input: CreateCustomerAddressInput): Promise<CustomerAddress> =>
    apiClient.post<CustomerAddress>(`/customers/${id}/addresses`, input),
  updateAddress: (id: string, addressId: string, input: UpdateCustomerAddressInput): Promise<CustomerAddress> =>
    apiClient.patch<CustomerAddress>(`/customers/${id}/addresses/${addressId}`, input),
  removeAddress: (id: string, addressId: string): Promise<CustomerAddress> =>
    apiClient.delete<CustomerAddress>(`/customers/${id}/addresses/${addressId}`),
};
