import { apiClient, type PaginatedResult } from '@/lib/api-client';
import type { GoodsReceipt, PurchaseOrderDetail, PurchaseOrderStatus, PurchaseOrderSummary } from './types';

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

export interface PurchaseOrderListParams {
  page: number;
  search: string;
  status?: PurchaseOrderStatus;
  supplierId?: string;
}

export interface PurchaseOrderItemInput {
  productId: string;
  quantity: number;
  unitCost?: string;
  discount?: string;
}

export interface CreatePurchaseOrderInput {
  supplierId: string;
  expectedDate?: string;
  notes?: string;
}

export interface UpdatePurchaseOrderInput {
  supplierId?: string;
  expectedDate?: string;
  discount?: string;
  tax?: string;
  shipping?: string;
  notes?: string;
}

export interface UpdatePurchaseOrderItemInput {
  quantity?: number;
  unitCost?: string;
  discount?: string;
}

export interface GoodsReceiptItemInput {
  purchaseOrderItemId: string;
  quantityReceived: number;
}

export interface CreateGoodsReceiptInput {
  items: GoodsReceiptItemInput[];
  note?: string;
}

function withoutEmpty(input: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== '' && value !== undefined));
}

export const purchaseOrdersApi = {
  list: ({ page, search, status, supplierId }: PurchaseOrderListParams): Promise<PaginatedResult<PurchaseOrderSummary>> =>
    apiClient.getPaginated<PurchaseOrderSummary>(`/purchase-orders${query({ page, limit: 20, search, status, supplierId })}`),
  get: (id: string): Promise<PurchaseOrderDetail> => apiClient.get<PurchaseOrderDetail>(`/purchase-orders/${id}`),
  create: (input: CreatePurchaseOrderInput): Promise<PurchaseOrderDetail> => apiClient.post<PurchaseOrderDetail>('/purchase-orders', withoutEmpty(input)),
  update: (id: string, input: UpdatePurchaseOrderInput): Promise<PurchaseOrderDetail> =>
    apiClient.patch<PurchaseOrderDetail>(`/purchase-orders/${id}`, withoutEmpty(input)),
  addItem: (id: string, input: PurchaseOrderItemInput): Promise<PurchaseOrderDetail> =>
    apiClient.post<PurchaseOrderDetail>(`/purchase-orders/${id}/items`, withoutEmpty(input)),
  updateItem: (id: string, itemId: string, input: UpdatePurchaseOrderItemInput): Promise<PurchaseOrderDetail> =>
    apiClient.patch<PurchaseOrderDetail>(`/purchase-orders/${id}/items/${itemId}`, withoutEmpty(input)),
  removeItem: (id: string, itemId: string): Promise<PurchaseOrderDetail> => apiClient.delete<PurchaseOrderDetail>(`/purchase-orders/${id}/items/${itemId}`),
  approve: (id: string): Promise<PurchaseOrderDetail> => apiClient.post<PurchaseOrderDetail>(`/purchase-orders/${id}/approve`),
  order: (id: string): Promise<PurchaseOrderDetail> => apiClient.post<PurchaseOrderDetail>(`/purchase-orders/${id}/order`),
  cancel: (id: string): Promise<PurchaseOrderDetail> => apiClient.post<PurchaseOrderDetail>(`/purchase-orders/${id}/cancel`),
  goodsReceipts: (id: string): Promise<GoodsReceipt[]> => apiClient.get<GoodsReceipt[]>(`/purchase-orders/${id}/goods-receipts`),
  receiveGoods: (id: string, input: CreateGoodsReceiptInput): Promise<GoodsReceipt> =>
    apiClient.post<GoodsReceipt>(`/purchase-orders/${id}/goods-receipts`, input),
};
