import { defineConfig } from 'vitest/config';
import serverConfig from './vitest.config';
// Never let this dedicated lane recreate the shared default test_database.
if (!/^amp_.*_test$/.test(process.env.TEST_DB_NAME ?? '')) throw new Error('Set TEST_DB_NAME to an isolated amp_*_test database');
export default defineConfig({ ...serverConfig, test: { ...serverConfig.test, projects: undefined, include: ['src/test/integration/ampMigrationPipeline.integration.test.ts'], coverage: { enabled: false }, fileParallelism: false, maxWorkers: 1, hookTimeout: 180000, testTimeout: 180000 } });
