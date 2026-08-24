import { apiClient } from '@/lib/api-client';
import type { InventoryReport, SalesReport, SalesReportPeriod, TopProduct } from './types';

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

export interface SalesReportParams {
  from?: string;
  to?: string;
  groupBy?: SalesReportPeriod;
}

export interface TopProductsParams {
  from?: string;
  to?: string;
  limit?: number;
}

export const reportsApi = {
  sales: ({ from, to, groupBy }: SalesReportParams): Promise<SalesReport> => apiClient.get<SalesReport>(`/reports/sales${query({ from, to, groupBy })}`),
  inventory: (): Promise<InventoryReport> => apiClient.get<InventoryReport>('/reports/inventory'),
  topProducts: ({ from, to, limit }: TopProductsParams): Promise<TopProduct[]> =>
    apiClient.get<TopProduct[]>(`/reports/top-products${query({ from, to, limit })}`),
};
