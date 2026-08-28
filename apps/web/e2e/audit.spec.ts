import { expect, test } from '@playwright/test';
import { resaveStorageState } from './support/auth';

test.use({ storageState: 'e2e/.auth/admin.json' });
test.afterEach(async ({ page }) => {
  await resaveStorageState(page, 'e2e/.auth/admin.json');
});

test.describe('audit', () => {
  test('shows a log entry after performing an action, and filters by entity', async ({ page }) => {
    // Perform an auditable action first so there is guaranteed to be at least one entry.
    await page.goto('/dashboard/settings');
    await page.getByRole('button', { name: 'New setting' }).click();
    const key = `e2e_audit_${Date.now().toString(36)}`;
    await page.getByLabel('Key *').fill(key);
    await page.getByLabel('Value *').fill('trigger');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto('/dashboard/audit');
    await expect(page.getByText('No audit entries found.')).toHaveCount(0);
    await expect(page.getByRole('row').nth(1)).toBeVisible();

    await page.getByRole('combobox').nth(1).selectOption({ label: 'Setting' });
    await expect(page.getByRole('row').first()).toBeVisible();
  });
});
