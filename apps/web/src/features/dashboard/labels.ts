import { isInboundMovement, STOCK_MOVEMENT_LABELS } from '@/lib/stock-movement-labels';
import type { RepairStatus } from './types';

export { STOCK_MOVEMENT_LABELS, isInboundMovement };

export const REPAIR_STATUS_LABELS: Record<RepairStatus, string> = {
  RECEIVED: 'Received',
  DIAGNOSING: 'Diagnosing',
  WAITING_APPROVAL: 'Waiting approval',
  APPROVED: 'Approved',
  IN_PROGRESS: 'In progress',
  WAITING_PARTS: 'Waiting parts',
  COMPLETED: 'Completed',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};
