import { apiClient, type PaginatedResult } from '@/lib/api-client';
import type { StockCountDetail, StockCountStatus, StockCountSummary } from './types';

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

export interface StockCountListParams {
  page: number;
  search: string;
  status?: StockCountStatus;
  locationId?: string;
}

export interface CreateStockCountInput {
  locationId: string;
  productIds?: string[];
  notes?: string;
}

export const stockCountsApi = {
  list: ({ page, search, status, locationId }: StockCountListParams): Promise<PaginatedResult<StockCountSummary>> =>
    apiClient.getPaginated<StockCountSummary>(`/stock-counts${query({ page, limit: 20, search, status, locationId })}`),
  get: (id: string): Promise<StockCountDetail> => apiClient.get<StockCountDetail>(`/stock-counts/${id}`),
  create: (input: CreateStockCountInput): Promise<StockCountDetail> => apiClient.post<StockCountDetail>('/stock-counts', input),
  update: (id: string, input: { notes?: string }): Promise<StockCountDetail> => apiClient.patch<StockCountDetail>(`/stock-counts/${id}`, input),
  addItem: (id: string, productId: string): Promise<StockCountDetail> => apiClient.post<StockCountDetail>(`/stock-counts/${id}/items`, { productId }),
  removeItem: (id: string, itemId: string): Promise<StockCountDetail> => apiClient.delete<StockCountDetail>(`/stock-counts/${id}/items/${itemId}`),
  start: (id: string): Promise<StockCountDetail> => apiClient.post<StockCountDetail>(`/stock-counts/${id}/start`),
  submitCount: (id: string, itemId: string, countedQuantity: number, notes?: string): Promise<StockCountDetail> =>
    apiClient.patch<StockCountDetail>(`/stock-counts/${id}/items/${itemId}/count`, { countedQuantity, notes }),
  submitForReview: (id: string): Promise<StockCountDetail> => apiClient.post<StockCountDetail>(`/stock-counts/${id}/submit-for-review`),
  approve: (id: string): Promise<StockCountDetail> => apiClient.post<StockCountDetail>(`/stock-counts/${id}/approve`),
  complete: (id: string): Promise<StockCountDetail> => apiClient.post<StockCountDetail>(`/stock-counts/${id}/complete`),
  cancel: (id: string): Promise<StockCountDetail> => apiClient.post<StockCountDetail>(`/stock-counts/${id}/cancel`),
};
