import { expect, test } from '@playwright/test';
import { resaveStorageState } from './support/auth';

// Purchase order writes are ADMIN/MANAGER only (see PurchaseOrdersController).
test.use({ storageState: 'e2e/.auth/admin.json' });
test.afterEach(async ({ page }) => {
  await resaveStorageState(page, 'e2e/.auth/admin.json');
});

const SUPPLIER_NAME = 'Northwind Components';
const PRODUCT_SKU = 'ACC-CBL-USBC2M';
const PRODUCT_NAME = 'USB-C Braided Cable 2m';

async function readQuantityOnCurrentPage(page: import('@playwright/test').Page): Promise<number> {
  await page.getByPlaceholder('Search by SKU or name').fill(PRODUCT_SKU);
  const row = page.getByRole('row').filter({ hasText: PRODUCT_SKU });
  await expect(row).toBeVisible();
  const text = await row.locator('td').nth(2).innerText();
  return Number(text);
}

async function expectQuantityOnCurrentPage(page: import('@playwright/test').Page, expected: number): Promise<void> {
  await page.getByPlaceholder('Search by SKU or name').fill(PRODUCT_SKU);
  const row = page.getByRole('row').filter({ hasText: PRODUCT_SKU });
  await expect(row.locator('td').nth(2)).toHaveText(String(expected));
}

test.describe('purchase orders', () => {
  test('a full receive restocks the item: draft, approve, order, receive', async ({ page }) => {
    await page.goto('/dashboard/inventory');
    const before = await readQuantityOnCurrentPage(page);

    await page.getByRole('link', { name: 'Purchase orders' }).click();
    await page.getByRole('button', { name: 'New purchase order' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByPlaceholder('Search suppliers by name, code or phone').fill(SUPPLIER_NAME);
    await page.getByRole('button', { name: SUPPLIER_NAME }).click();
    await page.getByRole('button', { name: 'Create draft' }).click();
    await page.waitForURL('**/dashboard/purchase-orders/*');

    await page.getByPlaceholder('Scan a barcode or search by SKU/name').fill(PRODUCT_SKU);
    await page.getByText(PRODUCT_NAME).click();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeEnabled();

    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('button', { name: 'Mark as ordered' })).toBeVisible();

    await page.getByRole('button', { name: 'Mark as ordered' }).click();
    await expect(page.getByRole('button', { name: 'Receive goods' })).toBeVisible();

    await page.getByRole('button', { name: 'Receive goods' }).click();
    await page.getByRole('button', { name: 'Record delivery' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Received', { exact: true }).first()).toBeVisible();

    await page.getByRole('link', { name: 'Inventory' }).click();
    await expectQuantityOnCurrentPage(page, before + 1);
  });

  test('cancelling a draft purchase order works and search finds it', async ({ page }) => {
    await page.goto('/dashboard/purchase-orders');

    await page.getByRole('button', { name: 'New purchase order' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByPlaceholder('Search suppliers by name, code or phone').fill(SUPPLIER_NAME);
    await page.getByRole('button', { name: SUPPLIER_NAME }).click();
    await page.getByRole('button', { name: 'Create draft' }).click();
    await page.waitForURL('**/dashboard/purchase-orders/*');

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible();
  });
});
