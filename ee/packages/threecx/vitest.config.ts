import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@shared', replacement: path.resolve(__dirname, '../../../shared') },
      {
        find: /^@alga-psa\/workflow-streams$/,
        replacement: path.resolve(__dirname, '../../../packages/workflow-streams/src/streams/index.ts'),
      },
      { find: /^@alga-psa\/shared\/(.*)$/, replacement: `${path.resolve(__dirname, '../../../shared')}/$1` },
      { find: /^@alga-psa\/event-bus$/, replacement: path.resolve(__dirname, '../../../packages/event-bus/src/index.ts') },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    passWithNoTests: true,
    testTimeout: 10000,
  },
});
