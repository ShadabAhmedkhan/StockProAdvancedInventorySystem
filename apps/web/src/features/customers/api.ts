import { createEntityApi } from '@/components/entity-crud/api-factory';
import type { Customer } from './types';

export const customersApi = createEntityApi<Customer>('/customers');
