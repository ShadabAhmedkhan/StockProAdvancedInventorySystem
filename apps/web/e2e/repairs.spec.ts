import { expect, test } from '@playwright/test';
import { resaveStorageState } from './support/auth';

test.use({ storageState: 'e2e/.auth/staff.json' });
test.afterEach(async ({ page }) => {
  await resaveStorageState(page, 'e2e/.auth/staff.json');
});

test.describe('repairs', () => {
  test('intake a device and move it through its first status change', async ({ page }) => {
    await page.goto('/dashboard/repairs');
    await page.getByRole('button', { name: 'Intake device' }).click();
    await page.waitForURL('**/dashboard/repairs/new');

    await page.getByPlaceholder('Search customers by name, phone or email').fill('a');
    const firstResult = page.locator('.absolute.z-10 button').first();
    await firstResult.waitFor();
    await firstResult.click();

    await page.getByLabel("What's wrong? *").fill('Screen is cracked from a drop, e2e test repair.');
    await page.getByRole('button', { name: 'Open repair' }).click();
    // Not just '**/dashboard/repairs/*' - that glob also matches the current /repairs/new
    // URL, so it would resolve immediately without waiting for the real navigation.
    await page.waitForURL(/\/dashboard\/repairs\/(?!new$)[^/]+$/);

    // "Received" also appears in the status-history entry below the badge, so scope to the first match.
    await expect(page.getByText('Received', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Move status' }).click();
    await page.getByLabel('New status').selectOption('DIAGNOSING');
    await page.getByRole('button', { name: 'Move', exact: true }).click();

    await expect(page.getByText('Diagnosing', { exact: true }).first()).toBeVisible();
  });
});
