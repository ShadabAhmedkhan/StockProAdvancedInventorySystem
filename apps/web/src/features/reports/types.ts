export type SalesReportPeriod = 'day' | 'week' | 'month';

export interface SalesReportPoint {
  period: string;
  orders: number;
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
}

export interface SalesReport {
  from: string | null;
  to: string | null;
  groupBy: SalesReportPeriod;
  points: SalesReportPoint[];
  totals: { orders: number; subtotal: string; discount: string; tax: string; total: string };
}

export interface CategoryValuationRow {
  categoryId: string;
  categoryName: string;
  productCount: number;
  totalUnits: number;
  valueAtCost: string;
  valueAtRetail: string;
  lowStockCount: number;
  outOfStockCount: number;
}

export interface StockSummary {
  totalProducts: number;
  totalUnits: number;
  inventoryValueAtCost: string;
  inventoryValueAtRetail: string;
  lowStockCount: number;
  outOfStockCount: number;
}

export interface InventoryReport {
  categories: CategoryValuationRow[];
  totals: StockSummary;
}

export interface TopProduct {
  productId: string;
  sku: string;
  name: string;
  quantitySold: number;
  revenue: string;
}
