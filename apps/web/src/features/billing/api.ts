import { apiClient } from '@/lib/api-client';
import type { BillingStatus } from './types';

export const billingApi = {
  status: (): Promise<BillingStatus> => apiClient.get<BillingStatus>('/billing/status'),
  createCheckoutSession: (): Promise<{ url: string }> => apiClient.post<{ url: string }>('/billing/checkout-session'),
  createPortalSession: (): Promise<{ url: string }> => apiClient.post<{ url: string }>('/billing/portal-session'),
};
