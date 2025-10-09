/**
 * Global setup for Playwright tests in EE server
 * This runs once before all tests and handles global initialization
 */

import dotenv from 'dotenv';
import path from 'path';

async function globalSetup() {
  console.log('🚀 Starting Playwright global setup...');
  
  // Load environment variables from the correct path
  dotenv.config({ path: path.resolve(__dirname, '.env') });
  
  // Ensure critical environment variables are set for tests
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.DB_HOST = process.env.DB_HOST || 'pgbouncer';
  process.env.DB_PORT = process.env.DB_PORT || '6432';
  process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'sebastian_test';
  process.env.DB_USER = process.env.DB_USER || 'postgres';
  process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'postpass123';
  process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || process.env.DB_PASSWORD || 'postpass123';
  process.env.ALGA_AUTH_KEY = process.env.ALGA_AUTH_KEY || '17e412b643525944dc1db02871c1b5dc93972f3c2147b9a9446e104b7495272b';

  // Build TEST_DATABASE_URL if not already set
  if (!process.env.TEST_DATABASE_URL) {
    process.env.TEST_DATABASE_URL = `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME_SERVER}`;
  }

  console.log('✅ Playwright test environment configured');
  console.log(`   - Database: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME_SERVER}`);
  console.log(`   - User: ${process.env.DB_USER}`);
}

export default globalSetup;