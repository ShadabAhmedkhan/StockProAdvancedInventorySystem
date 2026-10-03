import { formatDateTime } from '@/lib/format';
import type { OrganizationSubscriptionStatus, PlatformOrganizationActivity, PlatformOrganizationSummary } from './types';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `TRIAL_EXPIRED` is display-only: the API keeps a lapsed trial as `TRIALING`
 * with a past `trialEndsAt` (the subscription guard is what refuses it), but
 * the operator needs to see the difference at a glance.
 */
export type OrganizationDisplayStatus = OrganizationSubscriptionStatus | 'TRIAL_EXPIRED';

export const DISPLAY_STATUSES: readonly OrganizationDisplayStatus[] = ['TRIALING', 'TRIAL_EXPIRED', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'SUSPENDED'];

export const STATUS_LABELS: Record<OrganizationDisplayStatus, string> = {
  TRIALING: 'Trialing',
  TRIAL_EXPIRED: 'Trial expired',
  ACTIVE: 'Active',
  PAST_DUE: 'Past due',
  CANCELED: 'Canceled',
  SUSPENDED: 'Suspended',
};

export const STATUS_CLASSES: Record<OrganizationDisplayStatus, string> = {
  TRIALING: 'bg-blue-100 text-blue-800',
  TRIAL_EXPIRED: 'bg-orange-100 text-orange-800',
  ACTIVE: 'bg-green-100 text-green-800',
  PAST_DUE: 'bg-amber-100 text-amber-800',
  CANCELED: 'bg-neutral-100 text-neutral-800',
  SUSPENDED: 'bg-red-100 text-red-800',
};

export function displayStatus(
  organization: Pick<PlatformOrganizationSummary, 'subscriptionStatus' | 'trialEndsAt'>,
  now: number = Date.now(),
): OrganizationDisplayStatus {
  if (organization.subscriptionStatus === 'TRIALING' && (organization.trialEndsAt === null || new Date(organization.trialEndsAt).getTime() <= now)) {
    return 'TRIAL_EXPIRED';
  }
  return organization.subscriptionStatus;
}

/** Whole days remaining, rounded up - a trial ending in 3 hours still has "1 day left", not 0. */
export function trialDaysLeft(trialEndsAt: string, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - now) / ONE_DAY_MS));
}

/** Mirrors the API: an extension counts from the later of the current end and now. */
export function extendedTrialEnd(trialEndsAt: string | null, days: number, now: number = Date.now()): Date {
  const base = trialEndsAt === null ? now : Math.max(new Date(trialEndsAt).getTime(), now);
  return new Date(base + days * ONE_DAY_MS);
}

export function lastSeenLabel(lastLoginAt: string | null, now: number = Date.now()): string {
  if (lastLoginAt === null) {
    return 'Never logged in';
  }
  const days = Math.floor((now - new Date(lastLoginAt).getTime()) / ONE_DAY_MS);
  if (days <= 0) {
    return 'Last login today';
  }
  return `Last login ${String(days)} day${days === 1 ? '' : 's'} ago`;
}

export function activityLabel(activity: Pick<PlatformOrganizationActivity, 'action' | 'metadata'>): string {
  const metadata = activity.metadata ?? {};

  if (activity.action === 'UPDATE' && typeof metadata.extendedByDays === 'number') {
    const endsAt = typeof metadata.trialEndsAt === 'string' ? ` - now ends ${formatDateTime(metadata.trialEndsAt)}` : '';
    return `Trial extended by ${String(metadata.extendedByDays)} day${metadata.extendedByDays === 1 ? '' : 's'}${endsAt}`;
  }

  if (activity.action === 'STATUS_CHANGED' && typeof metadata.subscriptionStatus === 'string') {
    const status = metadata.subscriptionStatus;
    return status === 'SUSPENDED' ? 'Suspended' : `Reactivated as ${(STATUS_LABELS as Record<string, string | undefined>)[status] ?? status}`;
  }

  return activity.action;
}
