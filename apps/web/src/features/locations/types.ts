import type { EntityBase } from '@/components/entity-crud/types';

export type LocationType = 'STORE' | 'WAREHOUSE' | 'SERVICE_CENTER';

export interface Location extends EntityBase {
  organizationId: string;
  name: string;
  type: LocationType;
  address: string | null;
  isDefault: boolean;
  isActive: boolean;
}

export interface UserLocationAccess {
  id: string;
  userId: string;
  locationId: string;
  createdAt: string;
}
