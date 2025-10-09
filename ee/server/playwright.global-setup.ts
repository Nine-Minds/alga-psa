/**
 * Global setup for Playwright tests in EE server
 * This runs once before all tests and handles global initialization
 */
import dotenv from 'dotenv';
import path from 'path';
import { applyPlaywrightDatabaseEnv, PLAYWRIGHT_DB_CONFIG } from './src/__tests__/integration/utils/playwrightDatabaseConfig';

async function globalSetup() {
  console.log('🚀 Starting Playwright global setup...');

  dotenv.config({ path: path.resolve(__dirname, '.env') });

  applyPlaywrightDatabaseEnv();

  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS = process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS ?? 'true';
  process.env.ALGA_AUTH_KEY = process.env.ALGA_AUTH_KEY || '17e412b643525944dc1db02871c1b5dc93972f3c2147b9a9446e104b7495272b';

  if (!process.env.TEST_DATABASE_URL) {
    process.env.TEST_DATABASE_URL = `postgresql://${PLAYWRIGHT_DB_CONFIG.appUser}:${PLAYWRIGHT_DB_CONFIG.appPassword}@${PLAYWRIGHT_DB_CONFIG.host}:${PLAYWRIGHT_DB_CONFIG.port}/${PLAYWRIGHT_DB_CONFIG.database}`;
  }

  // DB reset is handled by webServer.command (bootstrap script) once per session.

  console.log('✅ Playwright test environment configured');
  console.log(`   - Database: ${PLAYWRIGHT_DB_CONFIG.host}:${PLAYWRIGHT_DB_CONFIG.port}/${PLAYWRIGHT_DB_CONFIG.database}`);
  console.log(`   - User: ${PLAYWRIGHT_DB_CONFIG.appUser}`);
}

export default globalSetup;
