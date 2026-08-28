import { expect, test } from '@playwright/test';
import { resaveStorageState, uniqueSuffix } from './support/auth';

test.use({ storageState: 'e2e/.auth/admin.json' });
test.afterEach(async ({ page }) => {
  await resaveStorageState(page, 'e2e/.auth/admin.json');
});

test.describe('settings', () => {
  test('create a setting and see it persist after reload', async ({ page }) => {
    await page.goto('/dashboard/settings');

    const suffix = uniqueSuffix();
    const key = `e2e_setting_${suffix}`;
    const value = `value-${suffix}`;

    await page.getByRole('button', { name: 'New setting' }).click();
    await page.getByLabel('Key *').fill(key);
    await page.getByLabel('Value *').fill(value);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await expect(page.getByRole('cell', { name: key, exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('cell', { name: key, exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: value, exact: true })).toBeVisible();
  });
});
