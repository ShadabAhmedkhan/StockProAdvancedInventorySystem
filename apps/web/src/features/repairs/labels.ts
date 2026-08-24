import { REPAIR_STATUS_LABELS } from '@/features/dashboard/labels';
import type { DeviceType, RepairStatus } from './types';

export { REPAIR_STATUS_LABELS };

export const REPAIR_STATUS_CLASSES: Record<RepairStatus, string> = {
  RECEIVED: 'bg-muted text-muted-foreground',
  DIAGNOSING: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  WAITING_APPROVAL: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  APPROVED: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  IN_PROGRESS: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  WAITING_PARTS: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  COMPLETED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  DELIVERED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
};

export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  PHONE: 'Phone',
  TABLET: 'Tablet',
  LAPTOP: 'Laptop',
  DESKTOP: 'Desktop',
  SMARTWATCH: 'Smartwatch',
  ACCESSORY: 'Accessory',
  OTHER: 'Other',
};
