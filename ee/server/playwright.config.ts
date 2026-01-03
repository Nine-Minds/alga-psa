import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import { spawnSync } from 'node:child_process';
import path from 'path';
import { applyPlaywrightDatabaseEnv } from './src/__tests__/integration/utils/playwrightDatabaseConfig';

// Load environment variables from the correct path
dotenv.config({ path: path.resolve(__dirname, '.env') });

// Don't set STORAGE_LOCAL_BASE_PATH - we want to use MinIO for tests
// const storageBasePath = path.resolve(__dirname, 'playwright-storage');
// if (!fs.existsSync(storageBasePath)) {
//   fs.mkdirSync(storageBasePath, { recursive: true });
// }
// process.env.STORAGE_LOCAL_BASE_PATH = process.env.STORAGE_LOCAL_BASE_PATH || storageBasePath;

// If Postgres runs in Docker and is published to a different host/port,
// override the Playwright DB connection to hit the direct Postgres port instead
// of PgBouncer.
//
// IMPORTANT: Do not fall back to DB_HOST/DB_PORT from `ee/server/.env` here.
// That file is a developer runtime env and may use non-default ports; Playwright
// should be self-contained and only deviate from defaults when explicitly configured.
const directDbHost =
  process.env.DB_DIRECT_HOST ||
  process.env.PLAYWRIGHT_DB_HOST ||
  process.env.EXPOSE_DB_HOST ||
  'localhost';
const directDbPort =
  process.env.DB_DIRECT_PORT ||
  process.env.PLAYWRIGHT_DB_PORT ||
  process.env.EXPOSE_DB_PORT ||
  '5432';

process.env.DB_DIRECT_HOST = process.env.DB_DIRECT_HOST || directDbHost;
process.env.DB_DIRECT_PORT = process.env.DB_DIRECT_PORT || directDbPort;

process.env.PLAYWRIGHT_DB_HOST = process.env.PLAYWRIGHT_DB_HOST || directDbHost;
process.env.PLAYWRIGHT_DB_PORT = process.env.PLAYWRIGHT_DB_PORT || directDbPort;

// Apply Playwright-specific database configuration
applyPlaywrightDatabaseEnv();

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

function runPortProbe(start: number, span: number, strict: boolean): { success: boolean; port?: number; error?: string } {
const script = `const net = require('net');
const start = Number(process.argv[1]);
const attempts = Number(process.argv[2]);
const strictMode = process.argv[3] === 'strict';
if (!Number.isFinite(start)) {
  console.error('invalid-port');
  process.exit(2);
}
function tryPort(port, attemptsLeft) {
  const server = net.createServer();
  server.unref();
  server.once('error', (err) => {
    if (strictMode || attemptsLeft <= 0) {
      console.error(err && err.code ? err.code : 'EADDRINUSE');
      process.exit(1);
    }
    tryPort(port + 1, attemptsLeft - 1);
  });
  server.listen(port, () => {
    server.close(() => {
      process.stdout.write(String(port));
      process.exit(0);
    });
  });
}
tryPort(start, attempts);
`;

  const result = spawnSync(process.execPath, ['--input-type=commonjs', '-e', script, String(start), String(span), strict ? 'strict' : 'flex'], {
    encoding: 'utf-8',
  });

  if (result.status === 0 && result.stdout) {
    return { success: true, port: Number(result.stdout.trim()) };
  }

  const error = (result.stderr || result.error?.message || '').trim();
  return { success: false, error: error || 'port-probe-failed' };
}

function resolveWebPortSync(): number {
  const preferred = Number(process.env.PLAYWRIGHT_APP_PORT || process.env.APP_PORT || 3300);
  if (process.env.PLAYWRIGHT_APP_PORT_LOCKED === 'true' && process.env.PLAYWRIGHT_APP_PORT) {
    if (!Number.isFinite(preferred)) {
      throw new Error(`Invalid PLAYWRIGHT_APP_PORT value: ${process.env.PLAYWRIGHT_APP_PORT}`);
    }
    return preferred;
  }
  if (process.env.PLAYWRIGHT_APP_PORT) {
    if (!Number.isFinite(preferred)) {
      throw new Error(`Invalid PLAYWRIGHT_APP_PORT value: ${process.env.PLAYWRIGHT_APP_PORT}`);
    }
    const check = runPortProbe(preferred, 0, true);
    if (!check.success || typeof check.port !== 'number') {
      // Even if a preferred port is provided, fall back to scanning for a nearby
      // available port to avoid spurious failures when developers have multiple
      // environments running locally.
      const fallback = runPortProbe(preferred, 25, false);
      if (!fallback.success || typeof fallback.port !== 'number') {
        throw new Error(`PLAYWRIGHT_APP_PORT=${preferred} is unavailable (${check.error || 'unknown error'}).`);
      }
      return fallback.port;
    }
    return check.port;
  }

  const probe = runPortProbe(preferred, 25, false);
  if (!probe.success || typeof probe.port !== 'number') {
    throw new Error(`Unable to find an available port for the Playwright dev server (${probe.error || 'probe failed'}).`);
  }
  return probe.port;
}

const PORT_CACHE_KEY = Symbol.for('__ALGA_PLAYWRIGHT_PORT__');

function getCachedWebPort(): number {
  const cached = globalThis[PORT_CACHE_KEY];
  if (typeof cached === 'number' && Number.isFinite(cached)) {
    return cached;
  }
  console.log('[Playwright] env before port detection', {
    PLAYWRIGHT_APP_PORT: process.env.PLAYWRIGHT_APP_PORT,
    APP_PORT: process.env.APP_PORT,
    PORT: process.env.PORT,
  });
  const resolved = resolveWebPortSync();
  globalThis[PORT_CACHE_KEY] = resolved;
  console.log(`[Playwright] using dev server port ${resolved}`);
  return resolved;
}

const resolvedWebPort = getCachedWebPort();
const webHost = process.env.PLAYWRIGHT_APP_HOST || 'localhost';
const resolvedBaseUrl = process.env.PLAYWRIGHT_BASE_URL || `http://${webHost}:${resolvedWebPort}`;

process.env.PLAYWRIGHT_APP_PORT = String(resolvedWebPort);
process.env.PLAYWRIGHT_APP_PORT_LOCKED = 'true';
process.env.EE_BASE_URL = process.env.EE_BASE_URL || resolvedBaseUrl;
process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || resolvedBaseUrl;
process.env.HOST = process.env.HOST || resolvedBaseUrl;
process.env.APP_PORT = process.env.APP_PORT || String(resolvedWebPort);
process.env.EXPOSE_SERVER_PORT = process.env.EXPOSE_SERVER_PORT || String(resolvedWebPort);
process.env.PORT = process.env.PORT || String(resolvedWebPort);

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

  /* Global teardown file */
  globalTeardown: './playwright.global-teardown.ts',

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
    baseURL: resolvedBaseUrl,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Take screenshot on failure */
    screenshot: 'only-on-failure',

    /* Record video on failure */
    video: 'retain-on-failure',

    /* Global test timeout */
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          headless: false,
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
    url: resolvedBaseUrl,
    // Reuse existing server by default for local development; set PW_REUSE=false to start fresh
    reuseExistingServer: process.env.PW_REUSE !== 'false',
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      NEXT_PUBLIC_EDITION: 'enterprise',
      E2E_AUTH_BYPASS: 'true',
      EE_BASE_URL: resolvedBaseUrl,
      NEXTAUTH_URL: resolvedBaseUrl,
      HOST: resolvedBaseUrl,
      PORT: String(resolvedWebPort),
      APP_PORT: String(resolvedWebPort),
      EXPOSE_SERVER_PORT: String(resolvedWebPort),
      NEXT_PUBLIC_APP_URL: resolvedBaseUrl,
      NEXT_PUBLIC_SITE_URL: resolvedBaseUrl,
      NEXT_PUBLIC_API_BASE_URL: resolvedBaseUrl,
      NEXT_PUBLIC_EXTERNAL_APP_URL: resolvedBaseUrl,
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || 'test-nextauth-secret',
      NEXT_PUBLIC_DISABLE_FEATURE_FLAGS: process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS ?? 'true',
      DB_HOST: process.env.DB_HOST,
      DB_PORT: process.env.DB_PORT,
      DB_NAME: process.env.DB_NAME,
      DB_NAME_SERVER: process.env.DB_NAME_SERVER,
      DB_USER: process.env.DB_USER,
      DB_PASSWORD: process.env.DB_PASSWORD,
      DB_USER_SERVER: process.env.DB_USER_SERVER,
      DB_PASSWORD_SERVER: process.env.DB_PASSWORD_SERVER,
      DB_PASSWORD_ADMIN: process.env.DB_PASSWORD_ADMIN,
      // Use S3/MinIO for file uploads (not local storage)
      // MinIO test instance runs on port 9002 (separate from Payload MinIO on 9000)
      STORAGE_DEFAULT_PROVIDER: 's3', // Use S3/MinIO instead of local storage
      STORAGE_S3_ENDPOINT: process.env.STORAGE_S3_ENDPOINT || 'http://localhost:9002',
      STORAGE_S3_ACCESS_KEY: process.env.STORAGE_S3_ACCESS_KEY || 'minioadmin',
      STORAGE_S3_SECRET_KEY: process.env.STORAGE_S3_SECRET_KEY || 'minioadmin',
      STORAGE_S3_BUCKET: process.env.STORAGE_S3_BUCKET || 'alga-test',
      STORAGE_S3_REGION: process.env.STORAGE_S3_REGION || 'us-east-1',
      STORAGE_S3_FORCE_PATH_STYLE: process.env.STORAGE_S3_FORCE_PATH_STYLE || 'true',
    }
  },

  /* Global test timeout */
  timeout: 60000,

  /* Test output directory */
  outputDir: 'playwright-test-results/',
});
