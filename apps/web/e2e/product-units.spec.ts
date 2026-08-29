import { expect, test } from '@playwright/test';
import { resaveStorageState, uniqueSuffix } from './support/auth';

// Creating a product and registering units are both restricted to ADMIN/MANAGER.
test.use({ storageState: 'e2e/.auth/admin.json' });
test.afterEach(async ({ page }) => {
  await resaveStorageState(page, 'e2e/.auth/admin.json');
});

test.describe('product units', () => {
  test('registers a serial-tracked unit and finds it by scanning', async ({ page }) => {
    const suffix = uniqueSuffix();
    const sku = `E2E-SN-${suffix}`;
    const name = `Playwright Serial Phone ${suffix}`;
    const serialNumber = `SN-${suffix}`;

    await page.goto('/dashboard/products');
    await page.getByRole('button', { name: 'New product' }).click();
    await page.getByLabel('SKU *').fill(sku);
    await page.getByLabel('Name *').fill(name);
    await page.getByLabel('Category *').selectOption({ index: 1 });
    await page.getByLabel('Cost price *').fill('100.00');
    await page.getByLabel('Selling price *').fill('199.99');
    await page.getByLabel('Unit tracking').selectOption('SERIAL');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto('/dashboard/product-units');
    await page.getByPlaceholder('Scan a barcode or search by SKU/name').fill(sku);
    await page.getByText(name, { exact: false }).click();
    await page.getByPlaceholder('Serial number or IMEI', { exact: true }).fill(serialNumber);
    await page.getByRole('button', { name: 'Register' }).click();
    await expect(page.getByText('Unit registered')).toBeVisible();
    await page.getByLabel('Scan serial number or IMEI').fill(serialNumber);
    await page.getByRole('button', { name: 'Look up' }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();

    await page.getByPlaceholder('Search by serial number or IMEI').fill(serialNumber);
    const row = page.getByRole('row').filter({ hasText: serialNumber });
    await expect(row).toBeVisible();

    await row.getByRole('combobox').selectOption('SOLD');
    await page.getByPlaceholder('Search by serial number or IMEI').fill(serialNumber);
    await expect(row.getByRole('combobox')).toHaveValue('SOLD');
  });
});
