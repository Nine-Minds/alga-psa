import { configDefaults, defineConfig } from 'vitest/config';
import path from 'path';
import { createMatchPath, loadConfig } from 'tsconfig-paths';

const workerPaths = loadConfig(path.join(__dirname, 'tsconfig.json'));
if (workerPaths.resultType !== 'success') throw new Error(`Cannot load worker source paths: ${workerPaths.message}`);
const matchWorkspacePath = createMatchPath(workerPaths.absoluteBaseUrl, workerPaths.paths, ['main'], false);

export default defineConfig({
  // Keep the worker's workspace source mappings in sync with its build. Explicit
  // aliases below retain runtime-specific overrides and take precedence.
  plugins: [{
    name: 'temporal-workspace-source-paths',
    enforce: 'pre',
    async resolveId(id, importer) {
      if (!id.startsWith('@alga-psa/')) return null;
      const source = matchWorkspacePath(id, undefined, undefined, ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json']);
      const resolved = await this.resolve(source ?? id, importer, { skipSelf: true });
      if (resolved && /\/(packages|shared)\/.*\/dist\//.test(resolved.id)) {
        throw new Error(`Workspace test import requires a source mapping: ${id}`);
      }
      return resolved;
    },
  }],
  test: {
    globals: true,
    // These suites use the server integration runner and its migrated DB.
    exclude: [...configDefaults.exclude, 'src/__tests__/integration/**'],
    environment: 'node',
    setupFiles: ['./src/test-utils/setup.ts'],
    testTimeout: 120000, // 2 minutes for E2E tests
    hookTimeout: 60000, // 1 minute for setup/teardown
    pool: 'forks', // Required for Temporal tests
    poolOptions: {
      forks: {
        singleFork: true, // Prevent issues with concurrent Temporal environments
      },
    },
    // Different configurations for different test types
    env: {
      NODE_ENV: 'test',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.d.ts',
        'src/test-utils/**',
        'src/__tests__/**',
        'scripts/**',
      ],
    },
  },
  resolve: {
    alias: [
      // Preserve the worker build's dependency-light notification implementation.
      { find: /^@alga-psa\/notifications\/(.*)$/, replacement: `${path.resolve(__dirname, './src/typings/notifications')}/$1` },
      { find: '@/lib/db', replacement: path.resolve(__dirname, '../server/src/lib/db.ts') },
      // Match the worker tsconfig's enterprise email-domain entry point.
      { find: '@alga-psa/integrations/email/domains/entry', replacement: path.resolve(__dirname, '../../packages/integrations/src/email/domains/ee/entry.ts') },
      // tsconfig maps @ee/* → ../server/src/*; mirror it here (strip the ESM .js suffix to hit the .ts source)
      { find: /^@ee\/(.*)\.js$/, replacement: `${path.resolve(__dirname, '../server/src')}/$1` },
      { find: /^@ee\/(.*)$/, replacement: `${path.resolve(__dirname, '../server/src')}/$1` },
      { find: /^@\/(.*)$/, replacement: `${path.resolve(__dirname, './src')}/$1` },
      { find: /^@shared\/(.*)$/, replacement: `${path.resolve(__dirname, '../../shared')}/$1` },
      { find: /^@ee\/(.*)$/, replacement: `${path.resolve(__dirname, '../server/src')}/$1` },
      { find: /^@alga-psa\/shared$/, replacement: path.resolve(__dirname, '../../shared') },
      { find: /^@alga-psa\/shared\/(.*)$/, replacement: `${path.resolve(__dirname, '../../shared')}/$1` },
      // Workspace packages resolved from source — their package.json entries
      // point at dist/, which is not built in test environments.
      { find: /^@alga-psa\/jobs$/, replacement: path.resolve(__dirname, '../../packages/jobs/src/index.ts') },
      { find: /^@alga-psa\/jobs\/fanout$/, replacement: path.resolve(__dirname, '../../packages/jobs/src/lib/fanout/index.ts') },
      { find: /^@alga-psa\/jobs\/runner$/, replacement: path.resolve(__dirname, '../../packages/jobs/src/lib/jobRunnerAccessor.ts') },
      { find: /^@alga-psa\/jobs\/scheduler$/, replacement: path.resolve(__dirname, '../../packages/jobs/src/lib/jobSchedulerAccessor.ts') },
      { find: /^@alga-psa\/jobs\/runners\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/jobs/src/lib/jobs/runners')}/$1` },
      { find: /^@alga-psa\/jobs\/handlers\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/jobs/src/lib/handlers')}/$1` },
      { find: /^@alga-psa\/jobs\/handler-utils\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/jobs/src/lib/handler-utils')}/$1` },
      { find: /^@alga-psa\/jobs\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/jobs/src')}/$1` },
      { find: /^@alga-psa\/email\/providerConfig$/, replacement: path.resolve(__dirname, '../../packages/email/src/providerConfig.ts') },
      { find: /^@alga-psa\/email$/, replacement: path.resolve(__dirname, '../../packages/email/src/index.ts') },
      { find: /^@alga-psa\/email\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/email/src')}/$1` },
      { find: /^@alga-psa\/workflows$/, replacement: path.resolve(__dirname, '../packages/workflows/src/index.ts') },
      { find: /^@alga-psa\/workflows\/runtime$/, replacement: path.resolve(__dirname, '../packages/workflows/src/runtime/index.ts') },
      { find: /^@alga-psa\/workflows\/persistence$/, replacement: path.resolve(__dirname, '../packages/workflows/src/persistence/index.ts') },
      { find: /^@alga-psa\/workflows\/(.*)$/, replacement: `${path.resolve(__dirname, '../packages/workflows/src')}/$1` },
      { find: /^@alga-psa\/db$/, replacement: path.resolve(__dirname, '../../packages/db/src/index.ts') },
      { find: '@alga-psa/db/workDate', replacement: path.resolve(__dirname, '../../packages/db/src/lib/workDate.ts') },
      // Accept the ESM .js specifier form used by runtime code (package exports map it to dist/).
      { find: /^@alga-psa\/db\/admin(\.js)?$/, replacement: path.resolve(__dirname, '../../packages/db/src/lib/admin.ts') },
      { find: /^@alga-psa\/db\/tenant(\.js)?$/, replacement: path.resolve(__dirname, '../../packages/db/src/lib/tenant.ts') },
      { find: /^@alga-psa\/db\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/db/src')}/$1` },
      { find: /^@alga-psa\/event-bus$/, replacement: path.resolve(__dirname, '../../packages/event-bus/src/index.ts') },
      { find: /^@alga-psa\/event-bus\/publishers$/, replacement: path.resolve(__dirname, '../../packages/event-bus/src/publishers/index.ts') },
      { find: /^@alga-psa\/event-bus\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/event-bus/src')}/$1` },
      { find: /^@alga-psa\/event-schemas$/, replacement: path.resolve(__dirname, '../../packages/event-schemas/src/index.ts') },
      { find: /^@alga-psa\/event-schemas\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/event-schemas/src')}/$1` },
      { find: /^@alga-psa\/storage$/, replacement: path.resolve(__dirname, '../../packages/storage/src/index.ts') },
      { find: /^@alga-psa\/storage\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/storage/src')}/$1` },
      { find: /^@alga-psa\/core$/, replacement: path.resolve(__dirname, '../../packages/core/src/index.ts') },
      { find: /^@alga-psa\/core\/secrets$/, replacement: path.resolve(__dirname, '../../packages/core/src/lib/secrets/index.ts') },
      { find: /^@alga-psa\/core\/logger$/, replacement: path.resolve(__dirname, '../../packages/core/src/lib/logger.ts') },
      { find: /^@alga-psa\/core\/encryption$/, replacement: path.resolve(__dirname, '../../packages/core/src/lib/encryption.ts') },
      { find: /^@alga-psa\/core\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/core/src')}/$1` },
      { find: /^@alga-psa\/marketing$/, replacement: path.resolve(__dirname, '../../packages/marketing/src/index.ts') },
      { find: /^@alga-psa\/marketing\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/marketing/src')}/$1` },
      { find: /^@alga-psa\/sla$/, replacement: path.resolve(__dirname, '../../packages/sla/src/index.ts') },
      { find: /^@alga-psa\/workflow-streams$/, replacement: path.resolve(__dirname, '../../packages/workflow-streams/src/streams/index.ts') },
      { find: /^@alga-psa\/sla\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/sla/src')}/$1` },
      { find: /^@alga-psa\/types$/, replacement: path.resolve(__dirname, '../../packages/types/src/index.ts') },
      { find: /^@alga-psa\/types\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/types/src')}/$1` },
    ],
  },
});
