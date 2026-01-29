import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || process.env.DEPLOY_BASE_URL;

if (!baseURL) {
  throw new Error('Set PLAYWRIGHT_BASE_URL or DEPLOY_BASE_URL to run deployment smoke tests.');
}

export default defineConfig({
  testDir: './src/__tests__/deploy',
  testMatch: ['**/*.playwright.test.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          headless: true,
        },
      },
    },
  ],
});

