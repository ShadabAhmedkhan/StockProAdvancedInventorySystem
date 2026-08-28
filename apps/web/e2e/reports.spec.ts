import { expect, test } from '@playwright/test';
import { resaveStorageState } from './support/auth';

test.use({ storageState: 'e2e/.auth/staff.json' });
test.afterEach(async ({ page }) => {
  await resaveStorageState(page, 'e2e/.auth/staff.json');
});

test.describe('reports', () => {
  test('sales tab loads with KPIs and no error state', async ({ page }) => {
    await page.goto('/dashboard/reports');

    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Total revenue' })).toBeVisible();
  });

  test('inventory and top products tabs render without error', async ({ page }) => {
    await page.goto('/dashboard/reports');

    await page.getByRole('button', { name: 'Inventory' }).click();
    await expect(page.getByRole('heading', { name: 'By category' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Value at cost' })).toBeVisible();

    await page.getByRole('button', { name: 'Top products' }).click();
    await expect(page.getByRole('heading', { name: 'Top products' })).toBeVisible();
  });
});
