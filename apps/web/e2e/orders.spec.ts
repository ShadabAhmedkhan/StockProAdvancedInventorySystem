import { expect, test } from '@playwright/test';
import { resaveStorageState } from './support/auth';

test.use({ storageState: 'e2e/.auth/staff.json' });
test.afterEach(async ({ page }) => {
  await resaveStorageState(page, 'e2e/.auth/staff.json');
});

const PRODUCT_SKU = 'ACC-CBL-USBC2M';
const PRODUCT_NAME = 'USB-C Braided Cable 2m';

/** Reads the on-hand quantity assuming the inventory page is already showing. Client-side nav
 * link clicks (not `page.goto`) keep the app mounted, so this only ever costs one real page
 * load - `/auth/refresh` is rate-limited and a hard reload per step burns through that budget. */
async function readQuantityOnCurrentPage(page: import('@playwright/test').Page): Promise<number> {
  await page.getByPlaceholder('Search by SKU or name').fill(PRODUCT_SKU);
  const row = page.getByRole('row').filter({ hasText: PRODUCT_SKU });
  await expect(row).toBeVisible();
  const text = await row.locator('td').nth(2).innerText();
  return Number(text);
}

/** `toBe` is a single synchronous read, so it can race the query refetch that follows
 * an invalidate. `toHaveText` auto-retries until the cell's content actually matches. */
async function expectQuantityOnCurrentPage(page: import('@playwright/test').Page, expected: number): Promise<void> {
  await page.getByPlaceholder('Search by SKU or name').fill(PRODUCT_SKU);
  const row = page.getByRole('row').filter({ hasText: PRODUCT_SKU });
  await expect(row.locator('td').nth(2)).toHaveText(String(expected));
}

test.describe('orders', () => {
  test('a full sale deducts stock: new sale, add item, confirm, complete', async ({ page }) => {
    await page.goto('/dashboard/inventory');
    const before = await readQuantityOnCurrentPage(page);

    await page.getByRole('link', { name: 'Orders' }).click();
    await page.getByRole('button', { name: 'New sale' }).click();
    await page.waitForURL('**/dashboard/orders/*');

    await page.getByPlaceholder('Search products by SKU or name to add a line').fill(PRODUCT_SKU);
    await page.getByText(PRODUCT_NAME).click();
    await expect(page.getByRole('button', { name: 'Confirm order' })).toBeEnabled();

    await page.getByRole('button', { name: 'Confirm order' }).click();
    await expect(page.getByRole('button', { name: 'Complete sale' })).toBeVisible();

    await page.getByRole('button', { name: 'Complete sale' }).click();
    await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();

    await page.getByRole('link', { name: 'Inventory' }).click();
    await expectQuantityOnCurrentPage(page, before - 1);
  });
});
