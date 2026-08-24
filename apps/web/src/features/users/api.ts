import { apiClient, type PaginatedResult } from '@/lib/api-client';
import type { AppUser, UserRole, UserStatus } from './types';

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

export interface UserListParams {
  page: number;
  search: string;
  role?: UserRole;
  status?: UserStatus;
}

export interface CreateUserInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  role: UserRole;
  status: UserStatus;
}

export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  email?: string;
}

export const usersApi = {
  list: ({ page, search, role, status }: UserListParams): Promise<PaginatedResult<AppUser>> =>
    apiClient.getPaginated<AppUser>(`/users${query({ page, limit: 20, search, role, status })}`),
  get: (id: string): Promise<AppUser> => apiClient.get<AppUser>(`/users/${id}`),
  create: (input: CreateUserInput): Promise<AppUser> => apiClient.post<AppUser>('/users', input),
  update: (id: string, input: UpdateUserInput): Promise<AppUser> => apiClient.patch<AppUser>(`/users/${id}`, input),
  changeRole: (id: string, role: UserRole): Promise<AppUser> => apiClient.patch<AppUser>(`/users/${id}/role`, { role }),
  changeStatus: (id: string, status: UserStatus): Promise<AppUser> => apiClient.patch<AppUser>(`/users/${id}/status`, { status }),
};
