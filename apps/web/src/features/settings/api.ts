import { apiClient } from '@/lib/api-client';
import type { Setting, SettingValueType } from './types';

export interface UpsertSettingInput {
  value: string;
  valueType: SettingValueType;
  description?: string;
}

export const settingsApi = {
  list: (): Promise<Setting[]> => apiClient.get<Setting[]>('/settings'),
  upsert: (key: string, input: UpsertSettingInput): Promise<Setting> => apiClient.put<Setting>(`/settings/${encodeURIComponent(key)}`, input),
  remove: (key: string): Promise<Setting> => apiClient.delete<Setting>(`/settings/${encodeURIComponent(key)}`),
};
