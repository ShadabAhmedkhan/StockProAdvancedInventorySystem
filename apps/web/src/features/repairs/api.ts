import type { AddPaymentInput } from '@/features/orders/api';
import { apiClient, type PaginatedResult } from '@/lib/api-client';
import type { DeviceType, RepairDetail, RepairStatus, RepairSummary } from './types';

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

export interface RepairListParams {
  page: number;
  search: string;
  status?: RepairStatus;
  deviceType?: DeviceType;
  openOnly?: boolean;
  overdue?: boolean;
  unassigned?: boolean;
}

export interface RepairIntakeInput {
  customerId: string;
  deviceType: DeviceType;
  brand?: string;
  model?: string;
  serialNumber?: string;
  imei?: string;
  problemDescription: string;
  diagnosis?: string;
  estimatedCost?: string;
  technicianId?: string;
  expectedCompletionAt?: string;
  notes?: string;
}

export interface RepairUpdateInput {
  diagnosis?: string;
  estimatedCost?: string;
  finalCost?: string;
  technicianId?: string;
  expectedCompletionAt?: string;
  notes?: string;
}

export interface RepairItemInput {
  productId: string;
  quantity: number;
  unitPrice?: string;
}

export interface ChangeRepairStatusInput {
  toStatus: RepairStatus;
  note?: string;
}

export interface Technician {
  id: string;
  firstName: string;
  lastName: string;
}

/** Reading `/users` is ADMIN/MANAGER-only, so this is called only when the signed-in user has that role. */
export const techniciansApi = {
  list: (): Promise<PaginatedResult<Technician>> => apiClient.getPaginated<Technician>('/users?role=TECHNICIAN&status=ACTIVE&limit=100'),
};

export const repairsApi = {
  list: ({ page, search, status, deviceType, openOnly, overdue, unassigned }: RepairListParams): Promise<PaginatedResult<RepairSummary>> =>
    apiClient.getPaginated<RepairSummary>(`/repairs${query({ page, limit: 20, search, status, deviceType, openOnly, overdue, unassigned })}`),
  get: (id: string): Promise<RepairDetail> => apiClient.get<RepairDetail>(`/repairs/${id}`),
  create: (input: RepairIntakeInput): Promise<RepairDetail> => apiClient.post<RepairDetail>('/repairs', withoutEmpty(input)),
  update: (id: string, input: RepairUpdateInput): Promise<RepairDetail> => apiClient.patch<RepairDetail>(`/repairs/${id}`, withoutEmpty(input)),
  changeStatus: (id: string, input: ChangeRepairStatusInput): Promise<RepairDetail> =>
    apiClient.post<RepairDetail>(`/repairs/${id}/status`, withoutEmpty(input)),
  addItem: (id: string, input: RepairItemInput): Promise<RepairDetail> => apiClient.post<RepairDetail>(`/repairs/${id}/items`, withoutEmpty(input)),
  updateItem: (id: string, itemId: string, quantity: number): Promise<RepairDetail> =>
    apiClient.patch<RepairDetail>(`/repairs/${id}/items/${itemId}`, { quantity }),
  removeItem: (id: string, itemId: string): Promise<RepairDetail> => apiClient.delete<RepairDetail>(`/repairs/${id}/items/${itemId}`),
  addPayment: (id: string, input: AddPaymentInput): Promise<unknown> => apiClient.post(`/repairs/${id}/payments`, withoutEmpty(input)),
};
