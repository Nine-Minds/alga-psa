/**
 * Global teardown for Playwright tests in EE server
 * This runs once after all tests complete
 */
import { execSync } from 'child_process';
import path from 'path';
import fs from 'node:fs';

async function globalTeardown() {
  console.log('🧹 Starting Playwright global teardown...');

  // Stop and remove test MinIO container
  console.log('🗑️  Stopping test MinIO container...');
  try {
    const marker = path.resolve(__dirname, '.playwright', 'minio-owned');
    const isOwnedByThisRun = fs.existsSync(marker);

    if (!isOwnedByThisRun) {
      console.log('ℹ️  MinIO container was reused; skipping teardown.');
      return;
    }

    const projectRoot = path.resolve(__dirname, '../..');
    execSync('docker compose -f docker-compose.playwright.yml down -v', {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    try {
      fs.unlinkSync(marker);
    } catch {
      // ignore
    }
    console.log('✅ MinIO test container stopped and removed');
  } catch (error) {
    console.error('❌ Failed to stop MinIO container:', error);
    // Don't throw - allow tests to complete even if cleanup fails
  }

  console.log('✅ Playwright teardown complete');
}

export default globalTeardown;
