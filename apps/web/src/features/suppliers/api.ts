import { createEntityApi } from '@/components/entity-crud/api-factory';
import type { Supplier } from './types';

export const suppliersApi = createEntityApi<Supplier>('/suppliers');
