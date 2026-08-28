import { expect, test } from '@playwright/test';
import { resaveStorageState, uniqueSuffix } from './support/auth';

test.use({ storageState: 'e2e/.auth/admin.json' });
test.afterEach(async ({ page }) => {
  await resaveStorageState(page, 'e2e/.auth/admin.json');
});

test.describe('finance', () => {
  test('recording an expense shows up in the list and moves the summary total', async ({ page }) => {
    const expensesKpi = page.locator('.rounded-lg.border').filter({ hasText: 'Expenses' }).first();

    await page.goto('/dashboard/finance');
    await page.getByRole('button', { name: 'Summary' }).click();
    const before = await expensesKpi.locator('p').first().innerText();

    await page.getByRole('button', { name: 'Expenses' }).click();
    const description = `Playwright e2e expense ${uniqueSuffix()}`;
    await page.getByRole('button', { name: 'Record expense' }).click();
    await page.getByLabel('Description *').fill(description);
    await page.getByLabel('Amount *').fill('12.34');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('cell', { name: description, exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Summary' }).click();
    await expect(expensesKpi.locator('p').first()).not.toHaveText(before);
  });
});
