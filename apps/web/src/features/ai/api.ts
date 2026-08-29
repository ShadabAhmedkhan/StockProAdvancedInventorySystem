import { apiClient } from '@/lib/api-client';
import type { AiAnswer } from './types';

export const aiApi = {
  ask: (question: string): Promise<AiAnswer> => apiClient.post<AiAnswer>('/ai/ask', { question }),
};
