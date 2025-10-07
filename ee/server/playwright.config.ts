import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import {
  applyPlaywrightDatabaseEnv,
  PLAYWRIGHT_DB_CONFIG,
} from './src/__tests__/integration/utils/playwrightDatabaseConfig';

// Load environment variables from the correct path
dotenv.config({ path: path.resolve(__dirname, '.env') });

// Ensure critical environment variables are set for tests
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
applyPlaywrightDatabaseEnv();
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-nextauth-secret';

/**
 * Playwright configuration for EE server integration tests
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './src/__tests__/integration',
  testMatch: ['**/contract-wizard-*.playwright.test.ts'],
  
  /* Global setup file */
  globalSetup: './playwright.global-setup.ts',
  
  /* Run tests in files in parallel */
  fullyParallel: false, // Disabled for database isolation
  
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : 1, // Single worker for database isolation
  
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['html'],
    ['json', { outputFile: 'playwright-report/results.json' }]
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
    command: 'cd ../../ && NEXT_PUBLIC_EDITION=enterprise npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      NEXT_PUBLIC_EDITION: 'enterprise',
      NEXTAUTH_URL: 'http://canonical.localhost:3000',
      NEXT_PUBLIC_DISABLE_FEATURE_FLAGS: 'true',
      DISABLE_FEATURE_FLAGS: 'true',
      DB_HOST: PLAYWRIGHT_DB_CONFIG.host,
      DB_PORT: String(PLAYWRIGHT_DB_CONFIG.port),
      DB_NAME: PLAYWRIGHT_DB_CONFIG.database,
      DB_USER: PLAYWRIGHT_DB_CONFIG.user,
      DB_PASSWORD: PLAYWRIGHT_DB_CONFIG.password,
      DB_SSL: PLAYWRIGHT_DB_CONFIG.ssl ? 'true' : 'false',
      DB_HOST_SERVER: PLAYWRIGHT_DB_CONFIG.host,
      DB_PORT_SERVER: String(PLAYWRIGHT_DB_CONFIG.port),
      DB_NAME_SERVER: PLAYWRIGHT_DB_CONFIG.database,
      DB_USER_SERVER: PLAYWRIGHT_DB_CONFIG.user,
      DB_PASSWORD_SERVER: PLAYWRIGHT_DB_CONFIG.password,
      DB_DIRECT_HOST: PLAYWRIGHT_DB_CONFIG.host,
      DB_DIRECT_PORT: String(PLAYWRIGHT_DB_CONFIG.port),
      DB_USER_ADMIN: process.env.DB_USER_ADMIN ?? PLAYWRIGHT_DB_CONFIG.user,
      DB_PASSWORD_ADMIN: process.env.DB_PASSWORD_ADMIN ?? PLAYWRIGHT_DB_CONFIG.password,
      DB_USER_READONLY: process.env.DB_USER_READONLY ?? PLAYWRIGHT_DB_CONFIG.user,
      DB_PASSWORD_READONLY: process.env.DB_PASSWORD_READONLY ?? PLAYWRIGHT_DB_CONFIG.password,
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    }
  },

  /* Global test timeout */
  timeout: 60000,

  /* Test output directory */
  outputDir: 'playwright-test-results/',
});
