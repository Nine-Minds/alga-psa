/**
 * Global teardown for Playwright tests in EE server
 * This runs once after all tests complete
 */
import { execSync } from 'child_process';
import path from 'path';
import fs from 'node:fs';

async function globalTeardown() {
  const keepDeps =
    process.env.PW_KEEP_DEPS === 'true' ||
    process.env.PW_SKIP_TEARDOWN === 'true';

  if (keepDeps) {
    console.log('🧹 Skipping Playwright global teardown (PW_KEEP_DEPS/PW_SKIP_TEARDOWN enabled).');
    return;
  }

  console.log('🧹 Starting Playwright global teardown...');

  // Stop and remove workflow deps (postgres/redis/worker) used by Playwright runs.
  console.log('🗑️  Stopping Playwright workflow deps...');
  try {
    const projectRoot = path.resolve(__dirname, '../..');
    execSync(
      'docker compose -f docker-compose.playwright-workflow-deps.yml -p alga-psa-playwright-workflow --env-file ee/server/.env down -v',
      { cwd: projectRoot, stdio: 'inherit' }
    );
    console.log('✅ Playwright workflow deps stopped and removed');
  } catch (error) {
    console.error('❌ Failed to stop Playwright workflow deps:', error);
    // Don't throw - allow teardown to continue
  }

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
