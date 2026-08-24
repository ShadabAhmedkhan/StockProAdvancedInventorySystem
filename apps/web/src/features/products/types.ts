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
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  category: { id: string; name: string; slug: string };
  brand: { id: string; name: string; slug: string } | null;
  inventory: { quantity: number; reservedQuantity: number; updatedAt: string } | null;
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
