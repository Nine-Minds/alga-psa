/**
 * Global teardown for Playwright tests in EE server
 * This runs once after all tests complete
 */
import { execSync } from 'child_process';
import path from 'path';

async function globalTeardown() {
  console.log('🧹 Starting Playwright global teardown...');

  // Stop and remove test MinIO container
  console.log('🗑️  Stopping test MinIO container...');
  try {
    const projectRoot = path.resolve(__dirname, '../..');
    execSync('docker compose -f docker-compose.playwright.yml down -v', {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    console.log('✅ MinIO test container stopped and removed');
  } catch (error) {
    console.error('❌ Failed to stop MinIO container:', error);
    // Don't throw - allow tests to complete even if cleanup fails
  }

  console.log('✅ Playwright teardown complete');
}

export default globalTeardown;
