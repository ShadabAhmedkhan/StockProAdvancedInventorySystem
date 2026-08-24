import { expect, test } from '@playwright/test';
import { resaveStorageState } from './support/auth';

test.describe('role-based access: STAFF', () => {
  test.use({ storageState: 'e2e/.auth/staff.json' });
  test.afterEach(async ({ page }) => {
    await resaveStorageState(page, 'e2e/.auth/staff.json');
  });

  test('does not see admin-only nav links and is refused by the API on direct navigation', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Audit' })).toHaveCount(0);

    // The backend, not client-side routing, is the actual authority: a STAFF
    // account hitting the URL directly gets a 403 surfaced as an error message.
    await page.goto('/dashboard/audit');
    await expect(page.getByText(/do not have permission/i)).toBeVisible();
  });

  test('cannot see a technician field on repair intake', async ({ page }) => {
    await page.goto('/dashboard/repairs/new');
    // Only ADMIN/MANAGER can read the technician directory, so STAFF never sees the field.
    // (Also proves the page genuinely loaded for STAFF, not a mistaken redirect to /login.)
    await expect(page.getByLabel("What's wrong? *")).toBeVisible();
    await expect(page.getByLabel('Technician')).toHaveCount(0);
  });
});

test.describe('role-based access: ADMIN', () => {
  test.use({ storageState: 'e2e/.auth/admin.json' });
  test.afterEach(async ({ page }) => {
    await resaveStorageState(page, 'e2e/.auth/admin.json');
  });

  test('sees every admin-only nav link', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: 'Users' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Audit' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  });
});
