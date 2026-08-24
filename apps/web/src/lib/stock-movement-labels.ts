export type StockMovementType = 'PURCHASE' | 'SALE' | 'RETURN_IN' | 'RETURN_OUT' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT' | 'REPAIR_IN' | 'REPAIR_OUT';

export const STOCK_MOVEMENT_LABELS: Record<StockMovementType, string> = {
  PURCHASE: 'Purchase',
  SALE: 'Sale',
  RETURN_IN: 'Return in',
  RETURN_OUT: 'Return out',
  ADJUSTMENT_IN: 'Adjustment in',
  ADJUSTMENT_OUT: 'Adjustment out',
  REPAIR_IN: 'Repair in',
  REPAIR_OUT: 'Repair out',
};

/** Movement types that add units to stock. */
const INBOUND_MOVEMENTS = new Set<StockMovementType>(['PURCHASE', 'RETURN_IN', 'ADJUSTMENT_IN', 'REPAIR_IN']);

export function isInboundMovement(type: StockMovementType): boolean {
  return INBOUND_MOVEMENTS.has(type);
}
