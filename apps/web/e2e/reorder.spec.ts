import { expect, test } from '@playwright/test';
import { resaveStorageState, uniqueSuffix } from './support/auth';

// Reading and editing reorder policy fields on a product is ADMIN/MANAGER territory.
test.use({ storageState: 'e2e/.auth/admin.json' });
test.afterEach(async ({ page }) => {
  await resaveStorageState(page, 'e2e/.auth/admin.json');
});

test.describe('reorder suggestions', () => {
  test('a product with a reorder point and low stock appears with the right suggested quantity', async ({ page }) => {
    const suffix = uniqueSuffix();
    const sku = `E2E-RO-${suffix}`;
    const name = `Playwright Reorder Widget ${suffix}`;

    await page.goto('/dashboard/products');
    await page.getByRole('button', { name: 'New product' }).click();
    await page.getByLabel('SKU *').fill(sku);
    await page.getByLabel('Name *').fill(name);
    await page.getByLabel('Category *').selectOption({ index: 1 });
    await page.getByLabel('Cost price *').fill('5.00');
    await page.getByLabel('Selling price *').fill('9.99');
    await page.getByLabel('Reorder point').fill('10');
    await page.getByLabel('Target stock').fill('30');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Bring it to 4 on hand: below the reorder point of 10, so it should need reordering.
    await page.getByRole('link', { name: 'Inventory' }).click();
    await page.getByPlaceholder('Search by SKU or name').fill(sku);
    const row = page.getByRole('row').filter({ hasText: sku });
    await row.getByRole('button', { name: 'Adjust' }).click();
    await page.getByLabel('Movement type').selectOption('PURCHASE');
    await page.getByLabel('Quantity').fill('4');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto('/dashboard/reorder');
    const suggestionRow = page.getByRole('row').filter({ hasText: sku });
    await expect(suggestionRow).toBeVisible();
    // available=4, incoming=0 -> suggested = target(30) - 4 = 26.
    await expect(suggestionRow).toContainText('26');

    // Unchecking "needs reorder only" keeps showing it (it still needs one); a product with no reorder point never appears either way.
    await page.getByLabel('Only show products that need reordering now').uncheck();
    await expect(suggestionRow).toBeVisible();
  });
});
