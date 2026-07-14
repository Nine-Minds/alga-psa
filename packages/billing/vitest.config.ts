import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [path.resolve(__dirname, './vitest.setup.ts')],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 20000,
    // Inline next-auth/@auth/core/next so vite transforms them and the next/server
    // alias below applies to next-auth's internal `import "next/server"`. Without it
    // the contract-wizard / automatic-invoices component suites render-crash on a
    // fresh CI install ("Cannot find module next/server"). Matches tickets.
    server: {
      deps: {
        inline: ['next-auth', '@auth/core', 'next'],
      },
    },
  },
  resolve: {
    alias: [
      { find: /^next\/server$/, replacement: path.resolve(__dirname, '../../node_modules/next/server.js') },
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
        find: /^@alga-psa\/db\/(admin|connection|tenant|workDate)$/,
        replacement: `${path.resolve(__dirname, '../db/src/lib')}/$1.ts`,
      },
      {
        find: /^@alga-psa\/auth\/sso\/entry$/,
        replacement: path.resolve(__dirname, '../auth/src/components/SsoProviderButtons.tsx'),
      },
      {
        find: /^@alga-psa\/auth\/(session|rbac|withAuth|apiAuth|nextAuthOptions|getCurrentUser)$/,
        replacement: `${path.resolve(__dirname, '../auth/src/lib')}/$1.ts`,
      },
      {
        find: /^@alga-psa\/auth\/types\/next-auth$/,
        replacement: path.resolve(__dirname, '../auth/src/types/next-auth.ts'),
      },
      {
        find: /^@alga-psa\/product-extension-actions$/,
        replacement: path.resolve(__dirname, '../product-extension-actions/oss/entry.ts'),
      },
      {
        find: /^@enterprise$/,
        replacement: path.resolve(__dirname, '../ee/src/index.ts'),
      },
      {
        find: /^@enterprise\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../ee/src')}/$1`,
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
