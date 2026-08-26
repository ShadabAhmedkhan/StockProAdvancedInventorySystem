import { ApiError, type ApiErrorBody, type ApiResponse } from '@/lib/api-client';
import { API_URL } from '@/lib/env';
import { getPlatformAdminToken, setPlatformAdminSession } from '@/lib/platform-admin-token';
import type { PlatformAdminSession, PlatformOrganizationSummary, PlatformOrganizationUser } from './types';

/**
 * A separate, minimal fetch wrapper rather than reusing `apiClient`: that
 * client always attaches the tenant access token and retries a 401 through
 * the tenant refresh-cookie flow, neither of which applies to this identity.
 * Sharing it would risk a tenant token leaking onto a platform-admin request
 * or vice versa.
 */
async function platformAdminRequest<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getPlatformAdminToken();

  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token !== null ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  const json: unknown = response.status === 204 ? undefined : await response.json();

  if (!response.ok) {
    throw new ApiError(response.status, json as ApiErrorBody);
  }

  return (json as ApiResponse<T>).data;
}

export const platformAdminApi = {
  login: (email: string, password: string): Promise<PlatformAdminSession> => platformAdminRequest<PlatformAdminSession>('/platform-admin/auth/login', { method: 'POST', body: { email, password } }),
  listOrganizations: (): Promise<PlatformOrganizationSummary[]> => platformAdminRequest<PlatformOrganizationSummary[]>('/platform-admin/organizations'),
  listOrganizationUsers: (organizationId: string): Promise<PlatformOrganizationUser[]> =>
    platformAdminRequest<PlatformOrganizationUser[]>(`/platform-admin/organizations/${organizationId}/users`),
  suspend: (organizationId: string): Promise<PlatformOrganizationSummary> =>
    platformAdminRequest<PlatformOrganizationSummary>(`/platform-admin/organizations/${organizationId}/suspend`, { method: 'PATCH' }),
  reactivate: (organizationId: string): Promise<PlatformOrganizationSummary> =>
    platformAdminRequest<PlatformOrganizationSummary>(`/platform-admin/organizations/${organizationId}/reactivate`, { method: 'PATCH' }),
};

export { setPlatformAdminSession };
