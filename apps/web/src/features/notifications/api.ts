import { apiClient, type PaginatedResult } from '@/lib/api-client';
import type { Notification, NotificationType } from './types';

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

export interface NotificationListParams {
  page: number;
  type?: NotificationType;
  isRead?: boolean;
}

export const notificationsApi = {
  list: ({ page, type, isRead }: NotificationListParams): Promise<PaginatedResult<Notification>> =>
    apiClient.getPaginated<Notification>(`/notifications${query({ page, limit: 20, type, isRead })}`),
  unreadCount: (): Promise<{ count: number }> => apiClient.get<{ count: number }>('/notifications/unread-count'),
  markRead: (id: string): Promise<Notification> => apiClient.post<Notification>(`/notifications/${id}/read`),
  markAllRead: (): Promise<{ count: number }> => apiClient.post<{ count: number }>('/notifications/read-all'),
};
