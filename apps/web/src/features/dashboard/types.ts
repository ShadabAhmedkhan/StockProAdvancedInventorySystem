import type { StockMovementType } from '@/lib/stock-movement-labels';

export type { StockMovementType };

export type RepairStatus =
  'RECEIVED' | 'DIAGNOSING' | 'WAITING_APPROVAL' | 'APPROVED' | 'IN_PROGRESS' | 'WAITING_PARTS' | 'COMPLETED' | 'DELIVERED' | 'CANCELLED';

export interface RecentSale {
  id: string;
  orderNumber: string;
  customerName: string | null;
  /** Fixed two-decimal money string, e.g. "129.99". */
  total: string;
  completedAt: string | null;
}

export interface StockMovement {
  id: string;
  type: StockMovementType;
  quantity: number;
  previousQuantity: number;
  newQuantity: number;
  note: string | null;
  createdAt: string;
  product: { id: string; sku: string; name: string };
  createdBy: { id: string; firstName: string; lastName: string };
}

export interface StockSummary {
  totalProducts: number;
  totalUnits: number;
  inventoryValueAtCost: string;
  inventoryValueAtRetail: string;
  lowStockCount: number;
  outOfStockCount: number;
}

export interface SalesChartPoint {
  date: string;
  revenue: string;
}

export interface DashboardSummary {
  sales: {
    totalOrders: number;
    today: string;
    thisMonth: string;
    grossRevenue: string;
  };
  finance: {
    expenses: string;
    netPosition: string;
  };
  inventory: StockSummary;
  repairs: {
    active: number;
    completed: number;
    statusDistribution: Record<RepairStatus, number>;
  };
  returns: {
    pending: number;
  };
  customers: {
    total: number;
  };
  recentSales: RecentSale[];
  recentStockMovements: StockMovement[];
  salesChart: SalesChartPoint[];
}
