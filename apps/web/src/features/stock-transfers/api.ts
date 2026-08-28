import { apiClient, type PaginatedResult } from '@/lib/api-client';
import type { StockTransferDetail, StockTransferStatus, StockTransferSummary } from './types';

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

export interface StockTransferListParams {
  page: number;
  search: string;
  status?: StockTransferStatus;
  sourceLocationId?: string;
  destinationLocationId?: string;
}

export interface StockTransferItemInput {
  productId: string;
  quantity: number;
}

export interface CreateStockTransferInput {
  sourceLocationId: string;
  destinationLocationId: string;
  notes?: string;
}

export interface UpdateStockTransferInput {
  notes?: string;
}

export interface UpdateStockTransferItemInput {
  quantity?: number;
}

function withoutEmpty(input: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== '' && value !== undefined));
}

export const stockTransfersApi = {
  list: ({ page, search, status, sourceLocationId, destinationLocationId }: StockTransferListParams): Promise<PaginatedResult<StockTransferSummary>> =>
    apiClient.getPaginated<StockTransferSummary>(`/stock-transfers${query({ page, limit: 20, search, status, sourceLocationId, destinationLocationId })}`),
  get: (id: string): Promise<StockTransferDetail> => apiClient.get<StockTransferDetail>(`/stock-transfers/${id}`),
  create: (input: CreateStockTransferInput): Promise<StockTransferDetail> => apiClient.post<StockTransferDetail>('/stock-transfers', withoutEmpty(input)),
  update: (id: string, input: UpdateStockTransferInput): Promise<StockTransferDetail> =>
    apiClient.patch<StockTransferDetail>(`/stock-transfers/${id}`, withoutEmpty(input)),
  addItem: (id: string, input: StockTransferItemInput): Promise<StockTransferDetail> =>
    apiClient.post<StockTransferDetail>(`/stock-transfers/${id}/items`, withoutEmpty(input)),
  updateItem: (id: string, itemId: string, input: UpdateStockTransferItemInput): Promise<StockTransferDetail> =>
    apiClient.patch<StockTransferDetail>(`/stock-transfers/${id}/items/${itemId}`, withoutEmpty(input)),
  removeItem: (id: string, itemId: string): Promise<StockTransferDetail> => apiClient.delete<StockTransferDetail>(`/stock-transfers/${id}/items/${itemId}`),
  request: (id: string): Promise<StockTransferDetail> => apiClient.post<StockTransferDetail>(`/stock-transfers/${id}/request`),
  approve: (id: string): Promise<StockTransferDetail> => apiClient.post<StockTransferDetail>(`/stock-transfers/${id}/approve`),
  ship: (id: string): Promise<StockTransferDetail> => apiClient.post<StockTransferDetail>(`/stock-transfers/${id}/ship`),
  complete: (id: string): Promise<StockTransferDetail> => apiClient.post<StockTransferDetail>(`/stock-transfers/${id}/complete`),
  cancel: (id: string): Promise<StockTransferDetail> => apiClient.post<StockTransferDetail>(`/stock-transfers/${id}/cancel`),
};
