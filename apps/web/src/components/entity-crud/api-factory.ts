import { apiClient } from '@/lib/api-client';
import type { EntityApi, ListParams } from './types';

const PAGE_LIMIT = 20;

/**
 * An empty string on an optional field (email, address, notes...) must be
 * omitted rather than sent - `@IsOptional` only skips validation when the key
 * is absent, so an empty string would still hit `@IsEmail` and fail.
 */
function buildPayload(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim() !== ''));
}

/** Customers and suppliers share an identical CRUD + soft-delete shape on the API; this builds the client for either. */
export function createEntityApi<T>(basePath: string): EntityApi<T> {
  return {
    list: ({ page, search, includeDeleted }: ListParams) => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_LIMIT), includeDeleted: String(includeDeleted) });
      if (search !== '') {
        params.set('search', search);
      }
      return apiClient.getPaginated<T>(`${basePath}?${params.toString()}`);
    },
    create: (values) => apiClient.post<T>(basePath, buildPayload(values)),
    update: (id, values) => apiClient.patch<T>(`${basePath}/${id}`, buildPayload(values)),
    remove: (id) => apiClient.delete<T>(`${basePath}/${id}`),
    restore: (id) => apiClient.post<T>(`${basePath}/${id}/restore`),
  };
}
