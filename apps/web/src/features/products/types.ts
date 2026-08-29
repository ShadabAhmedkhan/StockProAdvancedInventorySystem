import type { StockMovementType } from '@/lib/stock-movement-labels';

export type { StockMovementType };

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  deletedAt: string | null;
}

export interface Brand {
  id: string;
  name: string;
  slug: string;
  deletedAt: string | null;
}

export type ProductTrackingType = 'NONE' | 'SERIAL' | 'IMEI';
export type ProductCondition = 'NEW' | 'USED' | 'REFURBISHED';

export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  categoryId: string;
  brandId: string | null;
  /** Fixed two-decimal money strings. */
  costPrice: string;
  sellingPrice: string;
  minimumStock: number;
  isActive: boolean;
  trackingType: ProductTrackingType;
  model: string | null;
  variant: string | null;
  color: string | null;
  storage: string | null;
  condition: ProductCondition;
  warrantyMonths: number | null;
  reorderPoint: number | null;
  targetStock: number | null;
  safetyStock: number | null;
  supplierLeadTimeDays: number | null;
  preferredSupplierId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  category: { id: string; name: string; slug: string };
  brand: { id: string; name: string; slug: string } | null;
  preferredSupplier: { id: string; name: string } | null;
  inventory: { quantity: number; reservedQuantity: number; updatedAt: string } | null;
}

export type ProductUnitStatus = 'IN_STOCK' | 'SOLD' | 'RETURNED' | 'DAMAGED';

export interface ProductUnit {
  id: string;
  productId: string;
  locationId: string;
  serialNumber: string;
  status: ProductUnitStatus;
  createdAt: string;
  updatedAt: string;
  product: { id: string; sku: string; name: string; trackingType: ProductTrackingType };
  location: { id: string; name: string };
}

export type StockStatus = 'OK' | 'LOW' | 'OUT';

export interface StockLevel {
  productId: string;
  sku: string;
  barcode: string | null;
  name: string;
  categoryId: string;
  categoryName: string;
  brandId: string | null;
  brandName: string | null;
  costPrice: string;
  sellingPrice: string;
  minimumStock: number;
  isActive: boolean;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  stockStatus: StockStatus;
  updatedAt: string;
}

export interface StockSummary {
  totalProducts: number;
  totalUnits: number;
  inventoryValueAtCost: string;
  inventoryValueAtRetail: string;
  lowStockCount: number;
  outOfStockCount: number;
}

export type ManualMovementType = 'PURCHASE' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT';
export type StockReferenceType = 'ORDER' | 'RETURN' | 'REPAIR' | 'PURCHASE' | 'MANUAL';

export interface StockMovement {
  id: string;
  type: StockMovementType;
  quantity: number;
  previousQuantity: number;
  newQuantity: number;
  referenceType: StockReferenceType;
  referenceId: string | null;
  note: string | null;
  createdAt: string;
  product: { id: string; sku: string; name: string };
  createdBy: { id: string; firstName: string; lastName: string };
}

export interface ReorderSuggestion {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  reservedQuantity: number;
  availableStock: number;
  incomingStock: number;
  averageDailyDemand: string;
  reorderPoint: number;
  targetStock: number;
  safetyStock: number;
  leadTimeDays: number | null;
  preferredSupplierId: string | null;
  preferredSupplierName: string | null;
  suggestedReorderQuantity: number;
}

export interface StockAdjustmentResult {
  productId: string;
  sku: string;
  type: ManualMovementType;
  quantity: number;
  previousQuantity: number;
  newQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  movementId: string;
}
