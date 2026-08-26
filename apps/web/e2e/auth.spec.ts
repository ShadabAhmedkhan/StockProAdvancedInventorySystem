import { expect, test } from '@playwright/test';
import { login, resaveStorageState, SEEDED_ACCOUNTS, uniqueSuffix } from './support/auth';

test.describe('authentication', () => {
  test('an unauthenticated visitor is redirected away from a protected route', async ({ page }) => {
    await page.goto('/dashboard/orders');
    await page.waitForURL('**/login');
    await expect(page.getByRole('heading', { name: 'Sign in to Stock Pro' })).toBeVisible();
  });

  test('login with a bad password shows an error and stays on the login page', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(SEEDED_ACCOUNTS.admin.email);
    await page.getByLabel('Password').fill('WrongPassword123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(/invalid/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('a valid login lands on the dashboard and shows the signed-in user', async ({ page }) => {
    await login(page, SEEDED_ACCOUNTS.admin.email, SEEDED_ACCOUNTS.admin.password);
    await expect(page.getByText(`Amara Okafor · ADMIN`)).toBeVisible();
  });

  test('registering a new account creates a new organization and signs them in as its administrator', async ({ page }) => {
    const suffix = uniqueSuffix();
    await page.goto('/register');
    await page.getByLabel('Organization name').fill(`E2E Org ${suffix}`);
    await page.getByLabel('First name').fill('E2E');
    await page.getByLabel('Last name').fill('Registrant');
    await page.getByLabel('Email').fill(`e2e.registrant.${suffix}@stockpro.test`);
    await page.getByLabel('Password').fill('Passw0rdPlaywright!');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('**/dashboard');
    await expect(page.getByText(`E2E Registrant · ADMIN`)).toBeVisible();
    // The registrant is the founding administrator of a brand-new org, so the
    // admin-only areas are reachable - unlike a self-registered STAFF account.
    await expect(page.getByRole('link', { name: 'Audit' })).toBeVisible();
  });
});

// Starts from a pre-authenticated storageState rather than a real form submission:
// /auth/login is rate-limited to 5/min, and this file's other tests plus the global
// setup's two API logins already spend most of that budget in the same run.
test.describe('authenticated session', () => {
  test.use({ storageState: 'e2e/.auth/admin.json' });
  test.afterEach(async ({ page }) => {
    await resaveStorageState(page, 'e2e/.auth/admin.json');
  });

  test('the session survives a full page reload (silent refresh)', async ({ page }) => {
    await page.goto('/dashboard');
    // `goto` only waits for the `load` event, not for AuthProvider's in-flight /auth/refresh.
    // Reloading before that settles aborts the request before its rotated-token cookie is
    // applied, so the post-reload refresh presents the same, already-consumed token.
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
  });
});

// This test ends its own session, so it must not touch the shared admin.json chain: reusing
// it would consume the token every later spec needs, and resaving afterward would overwrite
// it with a dead cookie. It logs in through its own disposable API session instead.
test.describe('logout', () => {
  test('logout ends the session and protected routes redirect again', async ({ page }) => {
    const response = await page.request.post(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4002/api/v1'}/auth/login`, {
      data: { email: SEEDED_ACCOUNTS.admin.email, password: SEEDED_ACCOUNTS.admin.password },
    });
    if (!response.ok()) {
      throw new Error(`Logout test's own login failed: ${String(response.status())} ${await response.text()}`);
    }

    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/login**');
    await page.goto('/dashboard');
    await page.waitForURL('**/login**');
  });
});
