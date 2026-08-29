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

export interface AgingBucketRow {
  bucket: '0-30' | '31-60' | '61-90' | '90+' | 'never moved';
  productCount: number;
  valueAtCost: string;
}

export interface SupplierPerformanceRow {
  supplierId: string;
  supplierName: string;
  orderCount: number;
  totalSpend: string;
  avgLeadTimeDays: number | null;
  onTimeRate: string | null;
}

export interface TechnicianWorkloadRow {
  technicianId: string;
  technicianName: string;
  activeCount: number;
  completedCount: number;
}

export interface SalesAnalytics {
  from: string | null;
  to: string | null;
  orderCount: number;
  revenue: string;
  grossProfit: string;
  margin: string;
  averageOrderValue: string;
  discountRate: string;
  returnRate: string;
}

export interface InventoryAnalytics {
  categories: CategoryValuationRow[];
  byLocation: unknown[];
  totals: StockSummary;
  stockTurnover: string | null;
  deadStockCount: number;
  aging: AgingBucketRow[];
}

export interface PurchasingAnalytics {
  from: string | null;
  to: string | null;
  suppliers: SupplierPerformanceRow[];
}

export interface RepairsAnalytics {
  from: string | null;
  to: string | null;
  completionRate: string;
  avgTurnaroundDays: string | null;
  repairRevenue: string;
  technicianWorkload: TechnicianWorkloadRow[];
}

export interface FinanceSummary {
  from: string | null;
  to: string | null;
  income: { sale: string; repairPayment: string; otherIncome: string; total: string };
  refunds: string;
  expenses: { byCategory: Record<string, string>; total: string };
  netRevenue: string;
  netPosition: string;
}

export interface AdvancedAnalytics {
  sales: SalesAnalytics;
  inventory: InventoryAnalytics;
  purchasing: PurchasingAnalytics;
  repairs: RepairsAnalytics;
  finance: FinanceSummary;
}
