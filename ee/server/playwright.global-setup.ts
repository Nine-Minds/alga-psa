/**
 * Global setup for Playwright tests in EE server
 * This runs once before all tests and handles global initialization
 */
import dotenv from 'dotenv';
import path from 'path';
import { execSync } from 'child_process';
import { applyPlaywrightDatabaseEnv, PLAYWRIGHT_DB_CONFIG } from './src/__tests__/integration/utils/playwrightDatabaseConfig';

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
    execSync('docker compose -f docker-compose.playwright.yml up -d', {
      cwd: projectRoot,
      stdio: 'inherit',
    });

    // Wait for MinIO to be ready
    console.log('⏳ Waiting for MinIO to be ready...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Create test bucket
    execSync(
      'docker exec alga-psa-minio-test mc alias set local http://localhost:9000 minioadmin minioadmin && ' +
      'docker exec alga-psa-minio-test mc mb local/alga-test --ignore-existing',
      { stdio: 'inherit' }
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
