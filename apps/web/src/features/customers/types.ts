import type { EntityBase } from '@/components/entity-crud/types';

export interface Customer extends EntityBase {
  customerCode: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  address: string | null;
  notes: string | null;
}
