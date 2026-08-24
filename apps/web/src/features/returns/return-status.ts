import type { ReturnStatus } from './types';

/** Mirrors the API's RETURN_TRANSITIONS — the API remains the authority. */
export const RETURN_TRANSITIONS: Readonly<Record<ReturnStatus, readonly ReturnStatus[]>> = {
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: ['COMPLETED'],
  REJECTED: [],
  COMPLETED: [],
};
