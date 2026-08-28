import { expect, test } from '@playwright/test';
import { resaveStorageState, uniqueSuffix } from './support/auth';

test.use({ storageState: 'e2e/.auth/admin.json' });
test.afterEach(async ({ page }) => {
  await resaveStorageState(page, 'e2e/.auth/admin.json');
});

test.describe('users', () => {
  test('admin creates a staff user and it appears in the list', async ({ page }) => {
    await page.goto('/dashboard/users');

    const suffix = uniqueSuffix();
    const lastName = `Playwright${suffix}`;
    const email = `e2e.${suffix}@example.com`;

    await page.getByRole('button', { name: 'Create user' }).click();
    await page.getByLabel('First name *').fill('Casey');
    await page.getByLabel('Last name *').fill(lastName);
    await page.getByLabel('Email *').fill(email);
    await page.getByLabel('Password *').fill('Password123!');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByPlaceholder('Search by name or email').fill(email);
    await expect(page.getByRole('cell', { name: `Casey ${lastName}` })).toBeVisible();
  });
});
