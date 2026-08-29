import { apiClient, type PaginatedResult } from '@/lib/api-client';
import type { NotificationType } from '@/features/notifications/types';
import type { AutomationCondition, AutomationRule, UserRole } from './types';

export interface AutomationRuleInput {
  name: string;
  triggerType: NotificationType;
  conditions: AutomationCondition[];
  actionRoles: UserRole[];
  isActive: boolean;
}

export const automationRulesApi = {
  list: (page: number): Promise<PaginatedResult<AutomationRule>> => apiClient.getPaginated<AutomationRule>(`/automation-rules?page=${page}&limit=20`),
  create: (input: AutomationRuleInput): Promise<AutomationRule> => apiClient.post<AutomationRule>('/automation-rules', input),
  update: (id: string, input: AutomationRuleInput): Promise<AutomationRule> => apiClient.patch<AutomationRule>(`/automation-rules/${id}`, input),
  remove: (id: string): Promise<AutomationRule> => apiClient.delete<AutomationRule>(`/automation-rules/${id}`),
};
