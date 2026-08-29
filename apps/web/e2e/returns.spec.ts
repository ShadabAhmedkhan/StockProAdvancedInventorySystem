import { expect, test } from '@playwright/test';
import { resaveStorageState } from './support/auth';

test.use({ storageState: 'e2e/.auth/admin.json' });
test.afterEach(async ({ page }) => {
  await resaveStorageState(page, 'e2e/.auth/admin.json');
});

const PRODUCT_SKU = 'ACC-GLS-UNIV';
const PRODUCT_NAME = 'Universal Tempered Glass';

/** See orders.spec.ts: nav-link clicks instead of `page.goto` keep the app mounted so this
 * doesn't burn the rate-limited `/auth/refresh` budget on every check. */
async function readQuantityOnCurrentPage(page: import('@playwright/test').Page): Promise<number> {
  await page.getByPlaceholder('Search by SKU or name').fill(PRODUCT_SKU);
  const row = page.getByRole('row').filter({ hasText: PRODUCT_SKU });
  await expect(row).toBeVisible();
  const text = await row.locator('td').nth(2).innerText();
  return Number(text);
}

/** `toBe` on a value from `readQuantityOnCurrentPage` is a single synchronous read, so it can
 * race the query refetch that follows an invalidate. `toHaveText` auto-retries until the cell's
 * content actually matches. */
async function expectQuantityOnCurrentPage(page: import('@playwright/test').Page, expected: number): Promise<void> {
  await page.getByPlaceholder('Search by SKU or name').fill(PRODUCT_SKU);
  const row = page.getByRole('row').filter({ hasText: PRODUCT_SKU });
  await expect(row.locator('td').nth(2)).toHaveText(String(expected));
}

test.describe('returns', () => {
  test('a completed return restocks the item and refunds the customer', async ({ page }) => {
    await page.goto('/dashboard/inventory');
    const beforeSale = await readQuantityOnCurrentPage(page);

    // Sell it first, so there is a completed order to return against.
    await page.getByRole('link', { name: 'Orders', exact: true }).click();
    await page.getByRole('button', { name: 'New sale' }).click();
    await page.waitForURL('**/dashboard/orders/*');
    await page.getByPlaceholder('Scan a barcode or search by SKU/name').fill(PRODUCT_SKU);
    await page.getByText(PRODUCT_NAME).click();
    await page.getByRole('button', { name: 'Confirm order' }).click();
    await page.getByRole('button', { name: 'Complete sale' }).click();
    await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
    const orderNumber = await page.locator('h1').innerText();

    await page.getByRole('link', { name: 'Inventory' }).click();
    await expectQuantityOnCurrentPage(page, beforeSale - 1);

    // Now raise, approve and complete a return for that same order.
    await page.getByRole('link', { name: 'Returns' }).click();
    await page.getByRole('button', { name: 'Raise return' }).click();
    await page.getByPlaceholder('Search completed orders by order number').fill(orderNumber);
    await page.getByText(orderNumber, { exact: true }).click();
    await page.getByText(PRODUCT_NAME).locator('..').getByRole('checkbox').first().check();
    await page.getByLabel('Reason *').selectOption('DEFECTIVE');
    await page.getByRole('button', { name: 'Raise return' }).click();
    // Not '**/dashboard/returns/*' - that glob also matches the current /returns/new
    // URL, so it would resolve immediately without waiting for the real navigation.
    await page.waitForURL(/\/dashboard\/returns\/(?!new$)[^/]+$/);

    await page.getByRole('button', { name: 'Approve' }).click();
    const openCompleteDialog = page.getByRole('button', { name: 'Complete & refund' });
    await expect(openCompleteDialog).toBeVisible();
    await openCompleteDialog.click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Complete & refund' }).click();

    await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();

    await page.getByRole('link', { name: 'Inventory' }).click();
    await expectQuantityOnCurrentPage(page, beforeSale);
  });
});
