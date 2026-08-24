import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001/api/v1';

/**
 * Runs against a real, already-running API (see README for the "db:up" +
 * "dev:api" prerequisites) rather than mocking the network - the same
 * philosophy as the backend's own `.e2e-spec.ts` suite. It does not start or
 * reset the database itself, so repeated runs accumulate the accounts and
 * records they create; point it at a disposable database, not production
 * seed data you care about.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
  ],
  webServer: {
    command: `npx next dev -p ${String(PORT)}`,
    url: `http://localhost:${String(PORT)}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
    env: { NEXT_PUBLIC_API_URL: API_URL },
  },
});
