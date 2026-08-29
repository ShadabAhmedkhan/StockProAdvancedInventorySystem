import { expect, test } from '@playwright/test';
import { resaveStorageState, uniqueSuffix } from './support/auth';

// Opening, starting, reviewing, approving and completing a count are all ADMIN/MANAGER.
test.use({ storageState: 'e2e/.auth/admin.json' });
test.afterEach(async ({ page }) => {
  await resaveStorageState(page, 'e2e/.auth/admin.json');
});

const MAIN_LOCATION = 'Main Location';

test.describe('stock counts', () => {
  test('a full count applies its variance to inventory', async ({ page }) => {
    const suffix = uniqueSuffix();
    const sku = `E2E-SC-${suffix}`;
    const name = `Playwright Count Widget ${suffix}`;

    // Fresh product with a known starting quantity, so the test doesn't depend on seed data.
    await page.goto('/dashboard/products');
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
    const inventoryRow = page.getByRole('row').filter({ hasText: sku });
    await inventoryRow.getByRole('button', { name: 'Adjust' }).click();
    await page.getByLabel('Movement type').selectOption('PURCHASE');
    await page.getByLabel('Quantity').fill('10');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto('/dashboard/stock-counts');
    await page.getByRole('button', { name: 'New count' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByLabel('Location', { exact: true }).selectOption({ label: MAIN_LOCATION });
    await page.getByLabel('Include every product already held at this location').uncheck();
    await page.getByRole('button', { name: 'Create draft' }).click();
    await page.waitForURL('**/dashboard/stock-counts/*');

    await page.getByPlaceholder('Scan a barcode or search by SKU/name').fill(sku);
    await page.getByText(name, { exact: false }).click();
    await expect(page.getByText(sku)).toBeVisible();

    await page.getByRole('button', { name: 'Start counting' }).click();
    await expect(page.getByRole('button', { name: 'Submit for review' })).toBeVisible();

    // Blind counting: expected quantity is not shown while counting.
    await expect(page.getByRole('columnheader', { name: 'Expected' })).toHaveCount(0);

    const row = page.getByRole('row').filter({ hasText: sku });
    await row.getByRole('spinbutton').fill('8');
    await row.getByRole('spinbutton').blur();

    await page.getByRole('button', { name: 'Submit for review' }).click();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();

    // Now that it's in review, expected and variance are visible.
    await expect(page.getByRole('columnheader', { name: 'Expected' })).toBeVisible();
    const reviewRow = page.getByRole('row').filter({ hasText: sku });
    await expect(reviewRow).toContainText('10');
    await expect(reviewRow).toContainText('-2');

    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('button', { name: 'Complete' })).toBeVisible();

    await page.getByRole('button', { name: 'Complete' }).click();
    await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();

    await page.goto('/dashboard/inventory');
    await page.getByPlaceholder('Search by SKU or name').fill(sku);
    await expect(page.getByRole('row').filter({ hasText: sku }).locator('td').nth(2)).toHaveText('8');
  });

  test('cancelling a draft count works', async ({ page }) => {
    await page.goto('/dashboard/stock-counts');
    await page.getByRole('button', { name: 'New count' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByLabel('Location', { exact: true }).selectOption({ label: MAIN_LOCATION });
    await page.getByRole('button', { name: 'Create draft' }).click();
    await page.waitForURL('**/dashboard/stock-counts/*');

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible();
  });
});
