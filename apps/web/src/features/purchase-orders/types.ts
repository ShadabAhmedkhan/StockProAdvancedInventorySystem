export type PurchaseOrderStatus = 'DRAFT' | 'APPROVED' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';

export interface PurchaseOrderSupplierRef {
  id: string;
  supplierCode: string;
  name: string;
  phone?: string;
}

export interface PurchaseOrderCreatedBy {
  id: string;
  firstName: string;
  lastName: string;
}

export interface PurchaseOrderSummary {
  id: string;
  poNumber: string;
  supplierId: string;
  status: PurchaseOrderStatus;
  expectedDate: string | null;
  subtotal: string;
  discount: string;
  tax: string;
  shipping: string;
  total: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  supplier: PurchaseOrderSupplierRef;
  createdBy: PurchaseOrderCreatedBy;
  _count: { items: number };
}

export interface PurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  productId: string;
  quantity: number;
  receivedQuantity: number;
  unitCost: string;
  discount: string;
  total: string;
  createdAt: string;
  updatedAt: string;
  product: { id: string; sku: string; name: string };
}

export interface PurchaseOrderDetail extends Omit<PurchaseOrderSummary, '_count'> {
  items: PurchaseOrderItem[];
}

export interface GoodsReceiptItem {
  id: string;
  goodsReceiptId: string;
  purchaseOrderItemId: string;
  quantityReceived: number;
  createdAt: string;
}

export interface GoodsReceipt {
  id: string;
  grNumber: string;
  purchaseOrderId: string;
  note: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  /** Populated when listed via `findGoodsReceipts`; absent on the create response. */
  items?: GoodsReceiptItem[];
}
