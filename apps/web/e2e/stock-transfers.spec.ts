import { expect, test } from '@playwright/test';
import { resaveStorageState, uniqueSuffix } from './support/auth';

// Stock transfer writes are ADMIN/MANAGER only (see StockTransfersController).
test.use({ storageState: 'e2e/.auth/admin.json' });
test.afterEach(async ({ page }) => {
  await resaveStorageState(page, 'e2e/.auth/admin.json');
});

const PRODUCT_SKU = 'ACC-CBL-USBC2M';
const PRODUCT_NAME = 'USB-C Braided Cable 2m';

test.describe('stock transfers', () => {
  test('a full transfer moves stock from one location to another', async ({ page }) => {
    // Create a fresh destination location so this test doesn't depend on the seed's fixture data.
    const suffix = uniqueSuffix();
    const locationName = `Playwright Depot ${suffix}`;

    await page.goto('/dashboard/locations');
    await page.getByRole('button', { name: 'New' }).click();
    await page.getByLabel('Name *').fill(locationName);
    await page.getByLabel('Type').selectOption('WAREHOUSE');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto('/dashboard/stock-transfers');
    await page.getByRole('button', { name: 'New transfer' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByLabel('From').selectOption({ label: 'Main Location' });
    await page.getByRole('dialog').getByLabel('To').selectOption({ label: locationName });
    await page.getByRole('button', { name: 'Create draft' }).click();
    await page.waitForURL('**/dashboard/stock-transfers/*');

    await page.getByPlaceholder('Scan a barcode or search by SKU/name').fill(PRODUCT_SKU);
    await page.getByText(PRODUCT_NAME).click();
    await expect(page.getByRole('button', { name: 'Request' })).toBeEnabled();

    await page.getByRole('button', { name: 'Request' }).click();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();

    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('button', { name: 'Ship' })).toBeVisible();

    await page.getByRole('button', { name: 'Ship' }).click();
    await expect(page.getByRole('button', { name: 'Complete' })).toBeVisible();

    await page.getByRole('button', { name: 'Complete' }).click();
    await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
  });

  test('cancelling a draft transfer works', async ({ page }) => {
    const suffix = uniqueSuffix();
    const locationName = `Playwright Depot ${suffix}`;

    await page.goto('/dashboard/locations');
    await page.getByRole('button', { name: 'New' }).click();
    await page.getByLabel('Name *').fill(locationName);
    await page.getByLabel('Type').selectOption('WAREHOUSE');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto('/dashboard/stock-transfers');
    await page.getByRole('button', { name: 'New transfer' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByLabel('From').selectOption({ label: 'Main Location' });
    await page.getByRole('dialog').getByLabel('To').selectOption({ label: locationName });
    await page.getByRole('button', { name: 'Create draft' }).click();
    await page.waitForURL('**/dashboard/stock-transfers/*');

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible();
  });
});
