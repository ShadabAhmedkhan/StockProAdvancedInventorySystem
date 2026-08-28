import { expect, test } from '@playwright/test';
import { resaveStorageState, uniqueSuffix } from './support/auth';

// Creating a product and adjusting stock are both restricted to ADMIN/MANAGER.
test.use({ storageState: 'e2e/.auth/admin.json' });
test.afterEach(async ({ page }) => {
  await resaveStorageState(page, 'e2e/.auth/admin.json');
});

test.describe('inventory', () => {
  test('adjust stock for a freshly created product', async ({ page }) => {
    // Create a product first so the test doesn't depend on pre-existing fixture data.
    await page.goto('/dashboard/products');

    const suffix = uniqueSuffix();
    const sku = `E2E-INV-${suffix}`;
    const name = `Playwright Stock Widget ${suffix}`;

    await page.getByRole('button', { name: 'New product' }).click();
    await page.getByLabel('SKU *').fill(sku);
    await page.getByLabel('Name *').fill(name);
    await page.getByLabel('Category *').selectOption({ index: 1 });
    await page.getByLabel('Cost price *').fill('5.00');
    await page.getByLabel('Selling price *').fill('9.99');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('link', { name: 'Inventory' }).click();
    await page.getByPlaceholder('Search by SKU or name').fill(sku);
    const row = page.getByRole('row').filter({ hasText: sku });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Adjust' }).click();
    await page.getByLabel('Movement type').selectOption('PURCHASE');
    await page.getByLabel('Quantity').fill('7');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByPlaceholder('Search by SKU or name').fill(sku);
    await expect(row.locator('td').nth(2)).toHaveText('7');
  });
});
