import { createEntityApi } from '@/components/entity-crud/api-factory';
import { apiClient } from '@/lib/api-client';
import type { Location, UserLocationAccess } from './types';

export const locationsApi = {
  ...createEntityApi<Location>('/locations'),
  listAccess: (locationId: string): Promise<UserLocationAccess[]> => apiClient.get<UserLocationAccess[]>(`/locations/${locationId}/access`),
  grantAccess: (locationId: string, userId: string): Promise<UserLocationAccess> =>
    apiClient.post<UserLocationAccess>(`/locations/${locationId}/access`, { userId }),
  revokeAccess: async (locationId: string, userId: string): Promise<void> => {
    await apiClient.delete(`/locations/${locationId}/access/${userId}`);
  },
};
