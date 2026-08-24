import { expect, test } from '@playwright/test';
import { resaveStorageState } from './support/auth';

test.use({ storageState: 'e2e/.auth/admin.json' });
test.afterEach(async ({ page }) => {
  await resaveStorageState(page, 'e2e/.auth/admin.json');
});

test.describe('dashboard', () => {
  test('shows KPIs, the sales chart and recent activity after login', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page.getByText('Sales today')).toBeVisible();
    await expect(page.getByText('Net position')).toBeVisible();
    await expect(page.getByText('Active repairs')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent sales' })).toBeVisible();
  });
});
