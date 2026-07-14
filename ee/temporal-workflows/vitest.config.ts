import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
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
      // tsconfig maps @ee/* → ../server/src/*; mirror it here (strip the ESM .js suffix to hit the .ts source)
      { find: /^@ee\/(.*)\.js$/, replacement: `${path.resolve(__dirname, '../server/src')}/$1` },
      { find: /^@ee\/(.*)$/, replacement: `${path.resolve(__dirname, '../server/src')}/$1` },
      { find: /^@\/(.*)$/, replacement: `${path.resolve(__dirname, './src')}/$1` },
      { find: /^@shared\/(.*)$/, replacement: `${path.resolve(__dirname, '../../shared')}/$1` },
      { find: /^@alga-psa\/shared$/, replacement: path.resolve(__dirname, '../../shared') },
      { find: /^@alga-psa\/shared\/(.*)$/, replacement: `${path.resolve(__dirname, '../../shared')}/$1` },
      // Workspace packages resolved from source — their package.json entries
      // point at dist/, which is not built in test environments.
      { find: /^@alga-psa\/workflows$/, replacement: path.resolve(__dirname, '../packages/workflows/src/index.ts') },
      { find: /^@alga-psa\/workflows\/runtime$/, replacement: path.resolve(__dirname, '../packages/workflows/src/runtime/index.ts') },
      { find: /^@alga-psa\/workflows\/persistence$/, replacement: path.resolve(__dirname, '../packages/workflows/src/persistence/index.ts') },
      { find: /^@alga-psa\/workflows\/(.*)$/, replacement: `${path.resolve(__dirname, '../packages/workflows/src')}/$1` },
      { find: /^@alga-psa\/db$/, replacement: path.resolve(__dirname, '../../packages/db/src/index.ts') },
      // Accept the ESM .js specifier form used by runtime code (package exports map it to dist/).
      { find: /^@alga-psa\/db\/admin(\.js)?$/, replacement: path.resolve(__dirname, '../../packages/db/src/lib/admin.ts') },
      { find: /^@alga-psa\/db\/tenant(\.js)?$/, replacement: path.resolve(__dirname, '../../packages/db/src/lib/tenant.ts') },
      { find: /^@alga-psa\/db\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/db/src')}/$1` },
      { find: /^@alga-psa\/event-bus$/, replacement: path.resolve(__dirname, '../../packages/event-bus/src/index.ts') },
      { find: /^@alga-psa\/event-bus\/publishers$/, replacement: path.resolve(__dirname, '../../packages/event-bus/src/publishers/index.ts') },
      { find: /^@alga-psa\/event-bus\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/event-bus/src')}/$1` },
      { find: /^@alga-psa\/core$/, replacement: path.resolve(__dirname, '../../packages/core/src/index.ts') },
      { find: /^@alga-psa\/core\/secrets$/, replacement: path.resolve(__dirname, '../../packages/core/src/lib/secrets/index.ts') },
      { find: /^@alga-psa\/core\/logger$/, replacement: path.resolve(__dirname, '../../packages/core/src/lib/logger.ts') },
      { find: /^@alga-psa\/core\/encryption$/, replacement: path.resolve(__dirname, '../../packages/core/src/lib/encryption.ts') },
      { find: /^@alga-psa\/core\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/core/src')}/$1` },
    ],
  },
});