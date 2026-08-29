import type { EntityBase } from '@/components/entity-crud/types';
import type { OrderSummary } from '@/features/orders/types';
import type { RepairSummary } from '@/features/repairs/types';

export interface Customer extends EntityBase {
  customerCode: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  tags: string[];
}

export interface CustomerNote {
  id: string;
  organizationId: string;
  customerId: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export interface CustomerAddress {
  id: string;
  organizationId: string;
  customerId: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomerAddressInput {
  label: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault?: boolean;
}

export type UpdateCustomerAddressInput = Partial<CreateCustomerAddressInput>;

export interface CustomerOutstanding {
  orders: OrderSummary[];
  repairs: RepairSummary[];
}

export interface CustomerLifetimeValue {
  orderRevenue: string;
  repairRevenue: string;
  total: string;
}

export type CustomerTimelineEntryType = 'ORDER' | 'REPAIR' | 'RETURN' | 'NOTE';

export interface CustomerTimelineEntry {
  type: CustomerTimelineEntryType;
  id: string;
  timestamp: string;
  summary: string;
}
