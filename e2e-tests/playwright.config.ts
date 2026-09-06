import { defineConfig, devices } from '@playwright/test';

const edition = process.env.E2E_EDITION || 'community';
if (!['community', 'enterprise'].includes(edition)) {
  throw new Error('E2E_EDITION must be community or enterprise.');
}
if (process.env.E2E_AUTH_BYPASS === 'true') {
  throw new Error('Production journeys require real authentication.');
}

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: true,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  outputDir: './test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  metadata: {
    edition,
    sourceRevision: process.env.E2E_REVISION || process.env.GITHUB_SHA || 'unrecorded-local-revision',
    authentication: 'real-credentials',
    serverLifecycle: 'externally-started-production-build',
  },
  // The caller starts the built application and its migrated services first.
  // No dev server, JWT injection, or application route interception belongs here.
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    headless: false,
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 90_000,
  },
  projects: [{ name: `${edition}-chromium`, use: { ...devices['Desktop Chrome'] } }],
});
