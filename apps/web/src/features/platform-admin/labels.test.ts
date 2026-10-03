import { describe, expect, it } from 'vitest';
import { activityLabel, displayStatus, extendedTrialEnd, lastSeenLabel, trialDaysLeft } from './labels';

const NOW = new Date('2026-10-03T12:00:00Z').getTime();
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function iso(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

describe('displayStatus', () => {
  it('shows a trial whose end date has passed as expired', () => {
    expect(displayStatus({ subscriptionStatus: 'TRIALING', trialEndsAt: iso(-1000) }, NOW)).toBe('TRIAL_EXPIRED');
  });

  it('keeps a running trial as trialing', () => {
    expect(displayStatus({ subscriptionStatus: 'TRIALING', trialEndsAt: iso(ONE_DAY_MS) }, NOW)).toBe('TRIALING');
  });

  it('never marks a non-trial status as expired', () => {
    expect(displayStatus({ subscriptionStatus: 'SUSPENDED', trialEndsAt: iso(-ONE_DAY_MS) }, NOW)).toBe('SUSPENDED');
  });
});

describe('trialDaysLeft', () => {
  it('rounds a partial day up', () => {
    expect(trialDaysLeft(iso(3 * 60 * 60 * 1000), NOW)).toBe(1);
  });

  it('never goes below zero', () => {
    expect(trialDaysLeft(iso(-5 * ONE_DAY_MS), NOW)).toBe(0);
  });
});

describe('extendedTrialEnd', () => {
  it('adds to the current end of a running trial', () => {
    expect(extendedTrialEnd(iso(2 * ONE_DAY_MS), 7, NOW).getTime()).toBe(NOW + 9 * ONE_DAY_MS);
  });

  it('restarts a lapsed trial from now', () => {
    expect(extendedTrialEnd(iso(-10 * ONE_DAY_MS), 7, NOW).getTime()).toBe(NOW + 7 * ONE_DAY_MS);
  });

  it('starts from now when there is no trial date at all', () => {
    expect(extendedTrialEnd(null, 14, NOW).getTime()).toBe(NOW + 14 * ONE_DAY_MS);
  });
});

describe('lastSeenLabel', () => {
  it('handles a tenant that never logged in', () => {
    expect(lastSeenLabel(null, NOW)).toBe('Never logged in');
  });

  it('counts whole days since the last login', () => {
    expect(lastSeenLabel(iso(-3 * ONE_DAY_MS - 1000), NOW)).toBe('Last login 3 days ago');
  });

  it('reports a same-day login as today', () => {
    expect(lastSeenLabel(iso(-60_000), NOW)).toBe('Last login today');
  });
});

describe('activityLabel', () => {
  it('describes a trial extension', () => {
    expect(activityLabel({ action: 'UPDATE', metadata: { extendedByDays: 1 } })).toBe('Trial extended by 1 day');
  });

  it('describes a suspension and a reactivation', () => {
    expect(activityLabel({ action: 'STATUS_CHANGED', metadata: { subscriptionStatus: 'SUSPENDED' } })).toBe('Suspended');
    expect(activityLabel({ action: 'STATUS_CHANGED', metadata: { subscriptionStatus: 'TRIALING' } })).toBe('Reactivated as Trialing');
  });

  it('falls back to the raw action for anything unrecognised', () => {
    expect(activityLabel({ action: 'DELETE', metadata: null })).toBe('DELETE');
  });
});
