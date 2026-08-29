export type StockCountStatus = 'DRAFT' | 'COUNTING' | 'REVIEW' | 'APPROVED' | 'COMPLETED' | 'CANCELLED';

export interface StockCountItem {
  id: string;
  productId: string;
  /** Withheld (null) while the count is DRAFT or COUNTING - see the API's `withBlindCounting`. */
  expectedQuantity: number | null;
  countedQuantity: number | null;
  notes: string | null;
  product: { id: string; sku: string; name: string };
}

export interface StockCountSummary {
  id: string;
  countNumber: string;
  status: StockCountStatus;
  notes: string | null;
  createdAt: string;
  location: { id: string; name: string };
  createdBy: { id: string; firstName: string; lastName: string };
  _count: { items: number };
}

export interface StockCountDetail {
  id: string;
  countNumber: string;
  status: StockCountStatus;
  notes: string | null;
  approvedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  location: { id: string; name: string };
  createdBy: { id: string; firstName: string; lastName: string };
  approvedBy: { id: string; firstName: string; lastName: string } | null;
  items: StockCountItem[];
}
