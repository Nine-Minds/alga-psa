/**
 * Global setup for Playwright tests in EE server
 * This runs once before all tests and handles global initialization
 */
import dotenv from 'dotenv';
import path from 'path';
import { execSync } from 'child_process';
import fs from 'node:fs';
import { applyPlaywrightDatabaseEnv, PLAYWRIGHT_DB_CONFIG } from './src/__tests__/integration/utils/playwrightDatabaseConfig';
import os from 'node:os';

async function waitForHttpOk(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for ${url}: ${String((lastError as any)?.message ?? lastError ?? 'unknown error')}`);
}

const MINIO_CONTAINER_NAME = 'alga-psa-minio-test';
const MINIO_OWNERSHIP_MARKER = path.resolve(__dirname, '.playwright', 'minio-owned');

function ensurePlaywrightStateDir() {
  const dir = path.dirname(MINIO_OWNERSHIP_MARKER);
  fs.mkdirSync(dir, { recursive: true });
}

function containerExists(name: string): boolean {
  try {
    execSync(`docker inspect ${name}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function containerRunning(name: string): boolean {
  try {
    const out = execSync(`docker inspect -f "{{.State.Running}}" ${name}`, { encoding: 'utf-8' }).trim();
    return out === 'true';
  } catch {
    return false;
  }
}

async function globalSetup() {
  console.log('🚀 Starting Playwright global setup...');

  dotenv.config({ path: path.resolve(__dirname, '.env') });

  applyPlaywrightDatabaseEnv();

  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS = process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS ?? 'true';
  process.env.ALGA_AUTH_KEY = process.env.ALGA_AUTH_KEY || '17e412b643525944dc1db02871c1b5dc93972f3c2147b9a9446e104b7495272b';

  // Set MinIO/S3 environment variables for test helpers
  process.env.STORAGE_DEFAULT_PROVIDER = 's3'; // Use S3/MinIO for tests instead of local storage
  process.env.STORAGE_S3_ENDPOINT = process.env.STORAGE_S3_ENDPOINT || 'http://localhost:9002';
  process.env.STORAGE_S3_ACCESS_KEY = process.env.STORAGE_S3_ACCESS_KEY || 'minioadmin';
  process.env.STORAGE_S3_SECRET_KEY = process.env.STORAGE_S3_SECRET_KEY || 'minioadmin';
  process.env.STORAGE_S3_BUCKET = process.env.STORAGE_S3_BUCKET || 'alga-test';
  process.env.STORAGE_S3_REGION = process.env.STORAGE_S3_REGION || 'us-east-1';
  process.env.STORAGE_S3_FORCE_PATH_STYLE = process.env.STORAGE_S3_FORCE_PATH_STYLE || 'true';

  if (!process.env.TEST_DATABASE_URL) {
    process.env.TEST_DATABASE_URL = `postgresql://${PLAYWRIGHT_DB_CONFIG.appUser}:${PLAYWRIGHT_DB_CONFIG.appPassword}@${PLAYWRIGHT_DB_CONFIG.host}:${PLAYWRIGHT_DB_CONFIG.port}/${PLAYWRIGHT_DB_CONFIG.database}`;
  }

  // DB reset is handled by webServer.command (bootstrap script) once per session.

  // Start test MinIO container (on port 9002, separate from Payload MinIO on 9000)
  console.log('🗄️  Starting test MinIO container on port 9002...');
  try {
    const projectRoot = path.resolve(__dirname, '../..');
    ensurePlaywrightStateDir();

    const existed = containerExists(MINIO_CONTAINER_NAME);
    if (!existed) {
      try {
        execSync('docker compose -f docker-compose.playwright.yml up -d', {
          cwd: projectRoot,
          stdio: 'inherit',
        });
        fs.writeFileSync(MINIO_OWNERSHIP_MARKER, 'owned\n', { encoding: 'utf-8' });
      } catch (e) {
        // Race-safe: another process may have created the shared container after our check.
        if (containerExists(MINIO_CONTAINER_NAME)) {
          try {
            fs.unlinkSync(MINIO_OWNERSHIP_MARKER);
          } catch {
            // ignore
          }
          if (!containerRunning(MINIO_CONTAINER_NAME)) {
            execSync(`docker start ${MINIO_CONTAINER_NAME}`, { stdio: 'inherit' });
          }
        } else {
          throw e;
        }
      }
    } else {
      // If another worktree already created the shared MinIO container, reuse it.
      // Avoid docker compose here because docker-compose.playwright.yml uses fixed container_name.
      if (!containerRunning(MINIO_CONTAINER_NAME)) {
        execSync(`docker start ${MINIO_CONTAINER_NAME}`, { stdio: 'inherit' });
      }
      try {
        fs.unlinkSync(MINIO_OWNERSHIP_MARKER);
      } catch {
        // ignore
      }
    }

    // Wait for MinIO to be ready (host-published port 9002)
    console.log('⏳ Waiting for MinIO to be ready...');
    await waitForHttpOk('http://localhost:9002/minio/health/ready', 60_000);

    // Create test bucket
    // Use the dedicated mc image (minio/minio does not reliably ship mc).
    // Note: minio/mc does not include a shell; its entrypoint is `mc`.
    // Also: alias config does not persist across containers unless we share the config dir.
    const mcConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-playwright-mc-'));
    execSync(
      [
        'docker run --rm',
        '--network alga-psa-playwright-test',
        `-v "${mcConfigDir}:/root/.mc"`,
        'minio/mc:latest',
        'alias set local http://minio-test:9000 minioadmin minioadmin',
      ].join(' '),
      { cwd: projectRoot, stdio: 'inherit' }
    );
    execSync(
      [
        'docker run --rm',
        '--network alga-psa-playwright-test',
        `-v "${mcConfigDir}:/root/.mc"`,
        'minio/mc:latest',
        'mb local/alga-test --ignore-existing',
      ].join(' '),
      { cwd: projectRoot, stdio: 'inherit' }
    );

    console.log('✅ MinIO test container ready on port 9002');
  } catch (error) {
    console.error('❌ Failed to start MinIO container:', error);
    throw error;
  }

  console.log('✅ Playwright test environment configured');
  console.log(`   - Database: ${PLAYWRIGHT_DB_CONFIG.host}:${PLAYWRIGHT_DB_CONFIG.port}/${PLAYWRIGHT_DB_CONFIG.database}`);
  console.log(`   - User: ${PLAYWRIGHT_DB_CONFIG.appUser}`);
  console.log(`   - MinIO: http://localhost:9002 (test instance, separate from Payload)`);
}

export default globalSetup;
