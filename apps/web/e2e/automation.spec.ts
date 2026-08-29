import { expect, test } from '@playwright/test';
import { resaveStorageState, uniqueSuffix } from './support/auth';

test.use({ storageState: 'e2e/.auth/admin.json' });
test.afterEach(async ({ page }) => {
  await resaveStorageState(page, 'e2e/.auth/admin.json');
});

test.describe('automation rules', () => {
  test('creates a conditional rule, edits it, and deletes it', async ({ page }) => {
    const suffix = uniqueSuffix();
    const ruleName = `Playwright rule ${suffix}`;

    await page.goto('/dashboard/automation');
    await page.getByRole('button', { name: 'New rule' }).click();

    await page.getByLabel('Name').fill(ruleName);
    await page.getByLabel('WHEN').selectOption('LOW_STOCK');
    await page.getByRole('button', { name: 'Add condition' }).click();
    await page.locator('input[placeholder="value"]').fill('Laptops');
    await page.getByRole('checkbox', { name: 'MANAGER' }).check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const row = page.getByRole('row').filter({ hasText: ruleName });
    await expect(row).toBeVisible();
    await expect(row.getByText('Active', { exact: true })).toBeVisible();

    await row.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Active').uncheck();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row.getByText('Inactive', { exact: true })).toBeVisible();

    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(ruleName)).toHaveCount(0);
  });
});
