import type { RepairStatus } from './types';

/**
 * Mirrors `REPAIR_TRANSITIONS` in apps/api/src/repairs/repair-status.ts, so the
 * "change status" dialog only ever offers a move the API will actually accept.
 * The API is still the authority - this only shapes the choices shown.
 */
export const REPAIR_TRANSITIONS: Readonly<Record<RepairStatus, readonly RepairStatus[]>> = {
  RECEIVED: ['DIAGNOSING', 'CANCELLED'],
  DIAGNOSING: ['WAITING_APPROVAL', 'APPROVED', 'CANCELLED'],
  WAITING_APPROVAL: ['APPROVED', 'CANCELLED'],
  APPROVED: ['IN_PROGRESS', 'WAITING_PARTS', 'CANCELLED'],
  IN_PROGRESS: ['WAITING_PARTS', 'COMPLETED', 'CANCELLED'],
  WAITING_PARTS: ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export const OPEN_REPAIR_STATUSES: readonly RepairStatus[] = ['RECEIVED', 'DIAGNOSING', 'WAITING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'WAITING_PARTS'];

export const PAYABLE_REPAIR_STATUSES: readonly RepairStatus[] = ['COMPLETED', 'DELIVERED'];
