import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    passWithNoTests: true,
    testTimeout: 10000,
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: [
      {
        find: /^@alga-psa\/workflows(.*)$/,
        replacement: `${path.resolve(__dirname, './src')}$1`,
      },
      {
        find: /^@alga-psa\/core$/,
        replacement: path.resolve(__dirname, '../../../packages/core/src/index.ts'),
      },
      {
        find: /^@alga-psa\/core\/server$/,
        replacement: path.resolve(__dirname, '../../../packages/core/src/server.ts'),
      },
      {
        find: /^@alga-psa\/core\/(context|config)\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../../../packages/core/src')}/$1/$2`,
      },
      {
        find: /^@alga-psa\/core\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../../../packages/core/src/lib')}/$1`,
      },
      {
        find: /^@alga-psa\/db\/admin$/,
        replacement: path.resolve(__dirname, '../../../packages/db/src/lib/admin.ts'),
      },
      {
        find: /^@alga-psa\/db\/models\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../../../packages/db/src/models')}/$1`,
      },
      {
        find: /^@alga-psa\/db\/models$/,
        replacement: path.resolve(__dirname, '../../../packages/db/src/models/index.ts'),
      },
      {
        find: /^@alga-psa\/db\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../../../packages/db/src/lib')}/$1`,
      },
      {
        find: /^@alga-psa\/db$/,
        replacement: path.resolve(__dirname, '../../../packages/db/src/index.ts'),
      },
      {
        find: /^@alga-psa\/workflow-streams$/,
        replacement: path.resolve(__dirname, '../../../packages/workflow-streams/src/streams/index.ts'),
      },
      {
        find: /^@alga-psa\/shared\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../../../shared')}/$1`,
      },
      {
        find: /^@alga-psa\/([^/]+)\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../../../packages')}/$1/src/$2`,
      },
      {
        find: /^@alga-psa\/([^/]+)$/,
        replacement: `${path.resolve(__dirname, '../../../packages')}/$1/src`,
      },
      {
        find: '@shared',
        replacement: path.resolve(__dirname, '../../../shared'),
      },
    ],
  },
});
