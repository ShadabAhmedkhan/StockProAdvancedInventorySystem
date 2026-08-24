import type { EntityBase } from '@/components/entity-crud/types';

export interface Supplier extends EntityBase {
  supplierCode: string;
  name: string;
  contactPerson: string | null;
  phone: string;
  email: string | null;
  address: string | null;
  notes: string | null;
}
