import { expect, test } from '@playwright/test';
import { resaveStorageState, uniqueSuffix } from './support/auth';

test.use({ storageState: 'e2e/.auth/admin.json' });
test.afterEach(async ({ page }) => {
  await resaveStorageState(page, 'e2e/.auth/admin.json');
});

test.describe('point of sale', () => {
  test('a cash sale scans a product, charges in full and shows a receipt', async ({ page }) => {
    const suffix = uniqueSuffix();
    const sku = `E2E-POS-${suffix}`;
    const name = `Playwright POS Widget ${suffix}`;

    // Set up a product with stock to sell.
    await page.goto('/dashboard/products');
    await page.getByRole('button', { name: 'New product' }).click();
    await page.getByLabel('SKU *').fill(sku);
    await page.getByLabel('Name *').fill(name);
    await page.getByLabel('Category *').selectOption({ index: 1 });
    await page.getByLabel('Cost price *').fill('5.00');
    await page.getByLabel('Selling price *').fill('20.00');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('link', { name: 'Inventory' }).click();
    await page.getByPlaceholder('Search by SKU or name').fill(sku);
    const row = page.getByRole('row').filter({ hasText: sku });
    await row.getByRole('button', { name: 'Adjust' }).click();
    await page.getByLabel('Movement type').selectOption('PURCHASE');
    await page.getByLabel('Quantity').fill('10');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto('/dashboard/pos');
    await page.getByRole('button', { name: 'New sale' }).click();

    await page.getByPlaceholder('Scan a barcode or search by SKU/name').fill(sku);
    await page.getByRole('button', { name, exact: false }).first().click();
    await expect(page.getByText(name)).toBeVisible();

    await page.getByRole('button', { name: /Charge/ }).click();
    await expect(page.getByRole('heading', { name: 'Record a payment' })).toBeVisible();
    await page.getByLabel('Method').selectOption('CASH');
    await page.getByRole('button', { name: 'Record payment' }).click();

    await expect(page.getByText('Receipt', { exact: true })).toBeVisible();
    await expect(page.getByText(name, { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New sale' })).toBeVisible();
  });

  test('holding a sale returns it to the held sales list', async ({ page }) => {
    await page.goto('/dashboard/pos');
    await page.getByRole('button', { name: 'New sale' }).click();
    await expect(page.getByRole('button', { name: 'Hold sale' })).toBeVisible();
    const orderNumber = (await page.locator('h1').textContent())?.trim() ?? '';
    expect(orderNumber).not.toBe('');

    await page.getByRole('button', { name: 'Hold sale' }).click();
    await expect(page.getByRole('heading', { name: 'Held sales' })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(orderNumber) })).toBeVisible();
  });
});
