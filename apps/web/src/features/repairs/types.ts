import type { Payment, PaymentMethod } from '@/features/orders/types';

export type { Payment, PaymentMethod };

export type RepairStatus =
  'RECEIVED' | 'DIAGNOSING' | 'WAITING_APPROVAL' | 'APPROVED' | 'IN_PROGRESS' | 'WAITING_PARTS' | 'COMPLETED' | 'DELIVERED' | 'CANCELLED';
export type DeviceType = 'PHONE' | 'TABLET' | 'LAPTOP' | 'DESKTOP' | 'SMARTWATCH' | 'ACCESSORY' | 'OTHER';

export interface RepairCustomer {
  id: string;
  customerCode: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string | null;
}

export interface RepairTechnician {
  id: string;
  firstName: string;
  lastName: string;
}

export interface RepairSummary {
  id: string;
  repairNumber: string;
  customerId: string;
  deviceType: DeviceType;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  imei: string | null;
  problemDescription: string;
  diagnosis: string | null;
  estimatedCost: string | null;
  finalCost: string | null;
  technicianId: string | null;
  status: RepairStatus;
  receivedAt: string;
  expectedCompletionAt: string | null;
  completedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  customer: RepairCustomer;
  technician: RepairTechnician | null;
  partsTotal: string;
  paidAmount: string;
  outstanding: string | null;
  partsCount: number;
}

export interface RepairItem {
  id: string;
  repairId: string;
  productId: string;
  quantity: number;
  unitPrice: string;
  total: string;
  createdAt: string;
  updatedAt: string;
  product: { id: string; sku: string; name: string };
}

export interface RepairStatusHistoryEntry {
  id: string;
  repairId: string;
  fromStatus: RepairStatus | null;
  toStatus: RepairStatus;
  note: string | null;
  createdAt: string;
  changedBy: { id: string; firstName: string; lastName: string };
}

export interface RepairDetail extends Omit<RepairSummary, 'partsCount'> {
  items: RepairItem[];
  payments: Payment[];
  statusHistory: RepairStatusHistoryEntry[];
}
