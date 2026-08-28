import { expect, test } from '@playwright/test';
import { resaveStorageState, uniqueSuffix } from './support/auth';

// Creating a supplier is restricted to ADMIN/MANAGER (see SuppliersController).
test.use({ storageState: 'e2e/.auth/admin.json' });
test.afterEach(async ({ page }) => {
  await resaveStorageState(page, 'e2e/.auth/admin.json');
});

test.describe('suppliers', () => {
  test('create a supplier and find it by search', async ({ page }) => {
    await page.goto('/dashboard/suppliers');

    const suffix = uniqueSuffix();
    const code = `SUP-${suffix}`;
    const name = `Playwright Supplier ${suffix}`;

    await page.getByRole('button', { name: 'New' }).click();
    await page.getByLabel('Supplier code *').fill(code);
    await page.getByLabel('Trading name *').fill(name);
    await page.getByLabel('Phone *').fill('+1-555-0200');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByPlaceholder('Search by name, phone or email').fill(name);
    await expect(page.getByRole('cell', { name, exact: false })).toBeVisible();
  });
});
