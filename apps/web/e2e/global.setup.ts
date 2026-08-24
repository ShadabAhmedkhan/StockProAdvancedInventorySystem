import { test as setup } from '@playwright/test';
import { SEEDED_ACCOUNTS } from './support/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4002/api/v1';

/**
 * Logs in once per role directly against the API (not through the UI) and
 * saves the resulting refresh cookie as storage state. Every other spec that
 * doesn't specifically test the login form itself reuses one of these files
 * instead of submitting the form again - `POST /auth/login` is rate-limited
 * to 5 requests per minute per IP, which a full suite of UI logins blows
 * through in seconds.
 */
async function authenticateAs(page: import('@playwright/test').Page, path: string, email: string, password: string): Promise<void> {
  const response = await page.request.post(`${API_URL}/auth/login`, { data: { email, password } });
  if (!response.ok()) {
    throw new Error(`Setup login failed for ${email}: ${String(response.status())} ${await response.text()}`);
  }
  await page.context().storageState({ path });
}

setup('authenticate as admin', async ({ page }) => {
  await authenticateAs(page, 'e2e/.auth/admin.json', SEEDED_ACCOUNTS.admin.email, SEEDED_ACCOUNTS.admin.password);
});

setup('authenticate as staff', async ({ page }) => {
  await authenticateAs(page, 'e2e/.auth/staff.json', SEEDED_ACCOUNTS.staff.email, SEEDED_ACCOUNTS.staff.password);
});
