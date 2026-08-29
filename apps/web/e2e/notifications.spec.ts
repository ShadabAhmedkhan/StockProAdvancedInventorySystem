import { expect, test } from '@playwright/test';
import { resaveStorageState, uniqueSuffix } from './support/auth';

// ORDER_COMPLETED notifies ADMIN/MANAGER, not the STAFF member who rang up the sale -
// so this has to run as admin to see its own notification land.
test.use({ storageState: 'e2e/.auth/admin.json' });
test.afterEach(async ({ page }) => {
  await resaveStorageState(page, 'e2e/.auth/admin.json');
});

test.describe('notifications', () => {
  test('completing a sale notifies the bell, and the dropdown/page/mark-read all agree', async ({ page }) => {
    const suffix = uniqueSuffix();
    const sku = `E2E-NOTIF-${suffix}`;
    const name = `Playwright Notify Widget ${suffix}`;

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
    const row = page.getByRole('row').filter({ hasText: sku });
    await row.getByRole('button', { name: 'Adjust' }).click();
    await page.getByLabel('Movement type').selectOption('PURCHASE');
    await page.getByLabel('Quantity').fill('5');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto('/dashboard/pos');
    await page.getByRole('button', { name: 'New sale' }).click();
    await page.getByPlaceholder('Scan a barcode or search by SKU/name').fill(sku);
    await page.getByRole('button', { name, exact: false }).first().click();
    await expect(page.getByText(name)).toBeVisible();
    await page.getByRole('button', { name: /Charge/ }).click();
    await page.getByLabel('Method').selectOption('CASH');
    await page.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByText('Receipt', { exact: true })).toBeVisible();

    // The bell polls on an interval; reloading forces an immediate refetch instead of waiting it out.
    // Read the order number this sale actually got, so the assertions below target this
    // run's own notification rather than "Sale completed" entries left by earlier runs.
    const orderNumber = await page.locator('#pos-receipt p.text-muted-foreground').first().textContent();
    await page.reload();
    const bell = page.getByRole('button', { name: 'Notifications' });
    await expect(bell.locator('span').filter({ hasText: /^\d+\+?$/ })).toBeVisible();

    await bell.click();
    const entry = page.getByRole('button', { name: new RegExp(`Sale completed.*${orderNumber}`) });
    await expect(entry).toBeVisible();
    await entry.click();

    await page.goto('/dashboard/notifications');
    await expect(page.getByText(orderNumber ?? '', { exact: false }).first()).toBeVisible();

    await page.getByRole('combobox').nth(1).selectOption('READ');
    await expect(page.getByText(orderNumber ?? '', { exact: false }).first()).toBeVisible();
  });
});
