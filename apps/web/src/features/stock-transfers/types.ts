export type StockTransferStatus = 'DRAFT' | 'REQUESTED' | 'APPROVED' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED';

export interface StockTransferLocationRef {
  id: string;
  name: string;
}

export interface StockTransferCreatedBy {
  id: string;
  firstName: string;
  lastName: string;
}

export interface StockTransferSummary {
  id: string;
  transferNumber: string;
  sourceLocationId: string;
  destinationLocationId: string;
  status: StockTransferStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  sourceLocation: StockTransferLocationRef;
  destinationLocation: StockTransferLocationRef;
  createdBy: StockTransferCreatedBy;
  _count: { items: number };
}

export interface StockTransferItem {
  id: string;
  transferId: string;
  productId: string;
  quantity: number;
  createdAt: string;
  updatedAt: string;
  product: { id: string; sku: string; name: string };
}

export interface StockTransferDetail extends Omit<StockTransferSummary, '_count'> {
  items: StockTransferItem[];
}
