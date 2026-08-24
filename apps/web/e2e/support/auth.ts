import type { Page } from '@playwright/test';

export const SEEDED_ACCOUNTS = {
  admin: { email: 'admin@stockpro.test', password: 'Password123!', role: 'ADMIN' },
  manager: { email: 'manager@stockpro.test', password: 'Password123!', role: 'MANAGER' },
  staff: { email: 'staff1@stockpro.test', password: 'Password123!', role: 'STAFF' },
} as const;

export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
}

/** A short, sortable suffix so repeated runs never collide on unique fields (emails, codes). */
export function uniqueSuffix(): string {
  return Date.now().toString(36);
}

/**
 * Refresh tokens are single-use (`AuthService.refresh` calls `consume()`, which
 * rotates and invalidates the presented token). A `storageState` file is a
 * snapshot of one token, so the moment a test's first page load refreshes it,
 * that snapshot is spent - every later test loading the same file would
 * present an already-consumed token and get bounced to `/login`.
 *
 * Call this at the end of any test that used a shared `e2e/.auth/*.json`
 * storage state, so the next test in the chain inherits the token this one
 * was just issued instead of the stale one still on disk.
 */
export async function resaveStorageState(page: import('@playwright/test').Page, path: string): Promise<void> {
  await page.context().storageState({ path });
}
