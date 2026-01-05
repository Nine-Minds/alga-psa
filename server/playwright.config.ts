import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PORT || '3000';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './src/test/e2e',
  testMatch: ['**/*.playwright.test.ts'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 120000,

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          headless: false,
        },
      },
    },
  ],

  webServer: process.env.CI ? undefined : {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: process.env.PW_REUSE !== 'false',
    timeout: 120000,
    env: {
      ...process.env,
      // Database configuration
      DB_TYPE: 'postgres',
      DB_HOST: process.env.DB_HOST || 'localhost',
      DB_PORT: process.env.DB_PORT || '5432',
      DB_NAME_SERVER: process.env.DB_NAME_SERVER || 'ticket_response_state_test',
      DB_USER_SERVER: process.env.DB_USER_SERVER || 'app_user',
      DB_USER_ADMIN: process.env.DB_USER_ADMIN || 'postgres',
      DB_PASSWORD_SERVER: process.env.DB_PASSWORD_SERVER || 'postpass123',
      DB_PASSWORD_ADMIN: process.env.DB_PASSWORD_ADMIN || 'postgres',
      // Auth configuration
      E2E_AUTH_BYPASS: 'true',
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || 'test-nextauth-secret',
      NEXTAUTH_URL: `http://localhost:${PORT}`,
      // App configuration
      APP_NAME: 'alga-psa-test',
      APP_ENV: 'test',
      NODE_ENV: 'development',
      PORT: PORT,
    },
  },
});
