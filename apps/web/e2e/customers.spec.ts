import { expect, test } from '@playwright/test';
import { resaveStorageState, uniqueSuffix } from './support/auth';

test.use({ storageState: 'e2e/.auth/staff.json' });
test.afterEach(async ({ page }) => {
  await resaveStorageState(page, 'e2e/.auth/staff.json');
});

test.describe('customers', () => {
  test('create a customer and find it by search', async ({ page }) => {
    await page.goto('/dashboard/customers');

    const suffix = uniqueSuffix();
    const code = `E2E-${suffix}`;
    const lastName = `Playwright${suffix}`;

    await page.getByRole('button', { name: 'New' }).click();
    await page.getByLabel('Customer code *').fill(code);
    await page.getByLabel('First name *').fill('Casey');
    await page.getByLabel('Last name *').fill(lastName);
    await page.getByLabel('Phone *').fill('+1-555-0100');
    await page.getByLabel('Email').fill(`${code.toLowerCase()}@example.com`);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByPlaceholder('Search by name, phone or email').fill(lastName);
    await expect(page.getByRole('cell', { name: `Casey ${lastName}` })).toBeVisible();
  });
});
