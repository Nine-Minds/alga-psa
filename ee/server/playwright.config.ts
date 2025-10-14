import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { applyPlaywrightDatabaseEnv } from './src/__tests__/integration/utils/playwrightDatabaseConfig';

// Load environment variables from the correct path
dotenv.config({ path: path.resolve(__dirname, '.env') });

// If Postgres runs in Docker and is published to a different host port,
// override the Playwright DB host/port here. Prefer existing DB_* envs
// when available, otherwise fall back to common local defaults.
process.env.PLAYWRIGHT_DB_HOST =
  process.env.PLAYWRIGHT_DB_HOST || process.env.DB_HOST || 'localhost';
process.env.PLAYWRIGHT_DB_PORT =
  process.env.PLAYWRIGHT_DB_PORT || process.env.DB_DIRECT_PORT || process.env.DB_PORT || '5432';

// Apply Playwright-specific database configuration
applyPlaywrightDatabaseEnv();

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

/**
 * Playwright configuration for EE server integration tests
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './src/__tests__/integration',
  // Run all Playwright integration tests in this folder
  testMatch: ['**/*.playwright.test.ts'],

  /* Global setup file */
  globalSetup: './playwright.global-setup.ts',

  /* Run tests in files in parallel */
  fullyParallel: false, // Disabled for database isolation

  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,

  /* Retry control: CI default 2, local default 0, override with PW_RETRIES */
  retries: process.env.PW_RETRIES !== undefined
    ? Number(process.env.PW_RETRIES)
    : (process.env.CI ? 2 : 0),

  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : 1, // Single worker for database isolation

  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['list'],
    ['json', { outputFile: 'playwright-report/results.json' }],
    ['html', { open: 'never' }]
  ],

  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Take screenshot on failure */
    screenshot: 'only-on-failure',

    /* Record video on failure */
    video: 'retain-on-failure',

    /* Global test timeout */
    actionTimeout: 15000,
    navigationTimeout: 30000,
    headless: false
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--host-resolver-rules=MAP portal.acme.local 127.0.0.1,MAP canonical.localhost 127.0.0.1,MAP localhost 127.0.0.1'
          ],
        },
      },
    },

    // Uncomment for cross-browser testing
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },

    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: process.env.CI ? undefined : {
    // Reset DB once per session before starting the dev server.
    command: 'cd ../../ && node --import tsx/esm scripts/bootstrap-playwright-db.ts && NEXT_PUBLIC_EDITION=enterprise npm run dev',
    url: 'http://localhost:3000',
    // Fresh DB per run by default; allow override for local iteration
    reuseExistingServer: process.env.PW_REUSE === 'true' ? true : false,
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      NEXT_PUBLIC_EDITION: 'enterprise',
      NEXTAUTH_URL: 'http://localhost:3000',
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || 'test-nextauth-secret',
      E2E_AUTH_BYPASS: 'true',
      NEXT_PUBLIC_DISABLE_FEATURE_FLAGS: process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS ?? 'true',
      DB_HOST: process.env.DB_HOST,
      DB_PORT: process.env.DB_PORT,
      DB_NAME: process.env.DB_NAME,
      DB_NAME_SERVER: process.env.DB_NAME_SERVER,
      DB_USER: process.env.DB_USER,
      DB_PASSWORD: process.env.DB_PASSWORD,
      DB_USER_SERVER: process.env.DB_USER_SERVER,
      DB_PASSWORD_SERVER: process.env.DB_PASSWORD_SERVER,
      DB_PASSWORD_ADMIN: process.env.DB_PASSWORD_ADMIN
    }
  },

  /* Global test timeout */
  timeout: 60000,

  /* Test output directory */
  outputDir: 'playwright-test-results/',
});
