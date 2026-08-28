import { expect, test } from '@playwright/test';
import { resaveStorageState, uniqueSuffix } from './support/auth';

// Creating a product is restricted to ADMIN/MANAGER (see ProductsController).
test.use({ storageState: 'e2e/.auth/admin.json' });
test.afterEach(async ({ page }) => {
  await resaveStorageState(page, 'e2e/.auth/admin.json');
});

test.describe('products', () => {
  test('create a product and find it by search', async ({ page }) => {
    await page.goto('/dashboard/products');

    const suffix = uniqueSuffix();
    const sku = `E2E-${suffix}`;
    const name = `Playwright Widget ${suffix}`;

    await page.getByRole('button', { name: 'New product' }).click();
    await page.getByLabel('SKU *').fill(sku);
    await page.getByLabel('Name *').fill(name);
    await page.getByLabel('Category *').selectOption({ index: 1 });
    await page.getByLabel('Cost price *').fill('10.00');
    await page.getByLabel('Selling price *').fill('19.99');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByPlaceholder('Search by SKU, name or barcode').fill(sku);
    await expect(page.getByRole('cell', { name, exact: false })).toBeVisible();
  });

  test('sorting by a column header re-orders the rows', async ({ page }) => {
    await page.goto('/dashboard/products');

    const firstSkuCell = page.getByRole('row').nth(1).getByRole('cell').first();
    await expect(firstSkuCell).toBeVisible();

    // The seed data plus everything every other spec has created gives well
    // over one page of products, so toggling sort direction on a column with
    // varied values is virtually certain to change which row sorts first.
    await page.getByRole('button', { name: 'SKU' }).click();
    const descFirst = await firstSkuCell.innerText();

    await page.getByRole('button', { name: 'SKU' }).click();
    const ascFirst = await firstSkuCell.innerText();

    expect(ascFirst).not.toBe(descFirst);
  });
});
