import { apiClient } from '@/lib/api-client';
import type { DashboardSummary } from './types';

export function fetchDashboardSummary(): Promise<DashboardSummary> {
  return apiClient.get<DashboardSummary>('/dashboard');
}
