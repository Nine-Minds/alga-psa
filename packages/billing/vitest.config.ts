import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 10000,
  },
  resolve: {
    alias: [
      {
        find: /^@alga-psa\/billing\/(.*)$/,
        replacement: `${path.resolve(__dirname, './src')}/$1`,
      },
      {
        find: /^@alga-psa\/ui\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../ui/src')}/$1`,
      },
      {
        find: /^@alga-psa\/shared\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../../shared')}/$1`,
      },
      {
        find: /^@alga-psa\/workflow-streams$/,
        replacement: `${path.resolve(__dirname, '../workflow-streams/src/streams/index.ts')}`,
      },
      {
        find: /^@alga-psa\/workflow-streams\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../workflow-streams/src/streams/$1')}`,
      },
      {
        find: /^@alga-psa\/core\/logger$/,
        replacement: `${path.resolve(__dirname, '../core/src/lib/logger.ts')}`,
      },
      {
        find: /^@alga-psa\/([^/]+)\/(.*)$/,
        replacement: `${path.resolve(__dirname, '..')}/$1/src/$2`,
      },
      {
        find: /^@alga-psa\/([^/]+)$/,
        replacement: `${path.resolve(__dirname, '..')}/$1/src`,
      },
      {
        find: '@shared',
        replacement: path.resolve(__dirname, '../../shared'),
      },
      {
        find: '@alga-psa/event-bus',
        replacement: path.resolve(__dirname, '../event-bus/src'),
      },
      {
        find: '@alga-psa/types',
        replacement: path.resolve(__dirname, '../types/src'),
      },
    ],
  },
});
