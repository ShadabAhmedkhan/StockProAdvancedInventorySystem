import { expect, test } from '@playwright/test';
import { resaveStorageState } from './support/auth';

test.use({ storageState: 'e2e/.auth/staff.json' });
test.afterEach(async ({ page }) => {
  await resaveStorageState(page, 'e2e/.auth/staff.json');
});

// Opened via the visible trigger button rather than the Ctrl+K shortcut in
// every test but one: Chromium reserves that combination at the browser-chrome
// level in some configurations, which can swallow the keystroke before the
// page ever sees it - unrelated to whether the app's own listener works.
test.describe('command palette', () => {
  test('opens from its trigger button, filters by typing, and navigates on Enter', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Search or jump to...' }).click();
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();

    const search = page.getByLabel('Command palette search');
    await search.fill('Repairs');
    await expect(page.getByRole('option', { name: 'Go to Repairs' })).toBeVisible();

    await search.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
    await expect(page).toHaveURL(/\/dashboard\/repairs$/);
  });

  test('closes on Escape without navigating', async ({ page }) => {
    await page.goto('/dashboard/orders');

    await page.getByRole('button', { name: 'Search or jump to...' }).click();
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
    await expect(page).toHaveURL(/\/dashboard\/orders$/);
  });

  test('hides role-restricted commands from a STAFF session', async ({ page }) => {
    await page.goto('/dashboard');

    await page.getByRole('button', { name: 'Search or jump to...' }).click();
    await page.getByLabel('Command palette search').fill('Audit');

    await expect(page.getByText('No matching commands')).toBeVisible();
  });

  test('also opens with the Ctrl+K keyboard shortcut', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('body').click({ position: { x: 10, y: 10 } });

    await page.keyboard.press('Control+K');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  });
});
