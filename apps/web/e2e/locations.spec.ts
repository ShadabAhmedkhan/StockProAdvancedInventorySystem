import { expect, test } from '@playwright/test';
import { resaveStorageState, uniqueSuffix } from './support/auth';

// Creating a location is restricted to ADMIN/MANAGER (see LocationsController).
test.use({ storageState: 'e2e/.auth/admin.json' });
test.afterEach(async ({ page }) => {
  await resaveStorageState(page, 'e2e/.auth/admin.json');
});

test.describe('locations', () => {
  test('create a location and find it by search', async ({ page }) => {
    await page.goto('/dashboard/locations');

    const suffix = uniqueSuffix();
    const name = `Playwright Warehouse ${suffix}`;

    await page.getByRole('button', { name: 'New' }).click();
    await page.getByLabel('Name *').fill(name);
    await page.getByLabel('Type').selectOption('WAREHOUSE');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByPlaceholder('Search by name').fill(name);
    await expect(page.getByRole('cell', { name, exact: false })).toBeVisible();
  });

  test('deleting the default location is rejected', async ({ page }) => {
    await page.goto('/dashboard/locations');

    const defaultRow = page.getByRole('row').filter({ hasText: 'Yes' });
    await expect(defaultRow).toBeVisible();
    await defaultRow.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByLabel('Notifications alt+T').getByText('The default location cannot be deleted')).toBeVisible();
  });
});
