import { apiClient, type PaginatedResult } from '@/lib/api-client';
import type { AuditAction, AuditEntity, AuditLog } from './types';

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const suffix = search.toString();
  return suffix === '' ? '' : `?${suffix}`;
}

export interface AuditListParams {
  page: number;
  action?: AuditAction;
  entity?: AuditEntity;
  userId?: string;
}

export const auditApi = {
  list: ({ page, action, entity, userId }: AuditListParams): Promise<PaginatedResult<AuditLog>> =>
    apiClient.getPaginated<AuditLog>(`/audit${query({ page, limit: 20, action, entity, userId })}`),
};
