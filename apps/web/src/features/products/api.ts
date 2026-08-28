import { apiClient, type PaginatedResult } from '@/lib/api-client';
import type { Brand, Category, Product, StockAdjustmentResult, StockLevel, StockMovement, StockSummary } from './types';

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

/** Matches the API's PRODUCT_SORT_FIELDS whitelist (product-query.dto.ts). */
export type ProductSortField = 'createdAt' | 'updatedAt' | 'sku' | 'name' | 'costPrice' | 'sellingPrice' | 'minimumStock';

export interface ProductListParams {
  page: number;
  search: string;
  categoryId?: string;
  brandId?: string;
  includeDeleted: boolean;
  sortBy?: ProductSortField;
  sortOrder?: 'asc' | 'desc';
}

export interface ProductInput {
  sku: string;
  barcode?: string;
  name: string;
  description?: string;
  categoryId: string;
  brandId?: string;
  costPrice: string;
  sellingPrice: string;
  minimumStock: number;
  isActive: boolean;
}

/** Omits keys the API rejects on an optional field when empty (`@IsOptional` still validates a present empty string). */
function cleanInput(input: ProductInput): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== '' && value !== undefined));
}

export const productsApi = {
  list: ({ page, search, categoryId, brandId, includeDeleted, sortBy, sortOrder }: ProductListParams): Promise<PaginatedResult<Product>> =>
    apiClient.getPaginated<Product>(`/products${query({ page, limit: 20, search, categoryId, brandId, includeDeleted, sortBy, sortOrder })}`),
  create: (input: ProductInput): Promise<Product> => apiClient.post<Product>('/products', cleanInput(input)),
  update: (id: string, input: ProductInput): Promise<Product> => apiClient.patch<Product>(`/products/${id}`, cleanInput(input)),
  remove: (id: string): Promise<Product> => apiClient.delete<Product>(`/products/${id}`),
  restore: (id: string): Promise<Product> => apiClient.post<Product>(`/products/${id}/restore`),
};

export const categoriesApi = {
  list: (): Promise<PaginatedResult<Category>> => apiClient.getPaginated<Category>('/categories?limit=100'),
};

export const brandsApi = {
  list: (): Promise<PaginatedResult<Brand>> => apiClient.getPaginated<Brand>('/brands?limit=100'),
};

export interface StockListParams {
  page: number;
  search: string;
  stockStatus: 'ALL' | 'OK' | 'LOW' | 'OUT';
}

export interface MovementListParams {
  page: number;
  productId?: string;
}

export interface StockAdjustInput {
  productId: string;
  type: 'PURCHASE' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT';
  quantity: number;
  note?: string;
}

export const stockApi = {
  summary: (): Promise<StockSummary> => apiClient.get<StockSummary>('/stock/summary'),
  list: ({ page, search, stockStatus }: StockListParams): Promise<PaginatedResult<StockLevel>> =>
    apiClient.getPaginated<StockLevel>(`/stock${query({ page, limit: 20, search, stockStatus: stockStatus === 'ALL' ? undefined : stockStatus })}`),
  movements: ({ page, productId }: MovementListParams): Promise<PaginatedResult<StockMovement>> =>
    apiClient.getPaginated<StockMovement>(`/stock/movements${query({ page, limit: 20, productId })}`),
  adjust: (input: StockAdjustInput): Promise<StockAdjustmentResult> =>
    apiClient.post<StockAdjustmentResult>(
      '/stock/adjust',
      Object.fromEntries(Object.entries(input).filter(([, value]) => value !== '' && value !== undefined)),
    ),
};
