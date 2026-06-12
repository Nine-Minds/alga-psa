import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    passWithNoTests: true,
    testTimeout: 10000,
    server: {
      deps: {
        inline: ['next-auth', '@auth/core', 'next'],
      },
    },
  },
  resolve: {
    alias: [
      {
        find: /^@alga-psa\/workflows(.*)$/,
        replacement: `${path.resolve(__dirname, '../../ee/packages/workflows/src')}$1`,
      },
      {
        find: /^@alga-psa\/auth$/,
        replacement: path.resolve(__dirname, '../auth/src/index.ts'),
      },
      {
        find: /^@alga-psa\/auth\/sso\/entry$/,
        replacement: path.resolve(__dirname, '../auth/src/components/SsoProviderButtons.tsx'),
      },
      {
        find: /^@alga-psa\/auth\/session$/,
        replacement: path.resolve(__dirname, '../auth/src/lib/session.ts'),
      },
      {
        find: /^@alga-psa\/auth\/rbac$/,
        replacement: path.resolve(__dirname, '../auth/src/lib/rbac.ts'),
      },
      {
        find: /^@alga-psa\/auth\/withAuth$/,
        replacement: path.resolve(__dirname, '../auth/src/lib/withAuth.ts'),
      },
      {
        find: /^@alga-psa\/auth\/apiAuth$/,
        replacement: path.resolve(__dirname, '../auth/src/lib/apiAuth.ts'),
      },
      {
        find: /^@alga-psa\/auth\/types\/next-auth$/,
        replacement: path.resolve(__dirname, '../auth/src/types/next-auth.ts'),
      },
      {
        find: /^@alga-psa\/auth\/nextAuthOptions$/,
        replacement: path.resolve(__dirname, '../auth/src/lib/nextAuthOptions.ts'),
      },
      {
        find: /^@alga-psa\/auth\/getCurrentUser$/,
        replacement: path.resolve(__dirname, '../auth/src/lib/getCurrentUser.ts'),
      },
      {
        find: /^@alga-psa\/auth\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../auth/src')}/$1`,
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
        find: /^@alga-psa\/core$/,
        replacement: path.resolve(__dirname, '../core/src/index.ts'),
      },
      {
        find: /^@alga-psa\/core\/server$/,
        replacement: path.resolve(__dirname, '../core/src/server.ts'),
      },
      {
        find: /^@alga-psa\/core\/(context|config)\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../core/src')}/$1/$2`,
      },
      {
        find: /^@alga-psa\/core\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../core/src/lib')}/$1`,
      },
      {
        find: /^@alga-psa\/db\/admin$/,
        replacement: path.resolve(__dirname, '../db/src/lib/admin.ts'),
      },
      {
        find: /^@alga-psa\/db\/models\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../db/src/models')}/$1`,
      },
      {
        find: /^@alga-psa\/db\/models$/,
        replacement: path.resolve(__dirname, '../db/src/models/index.ts'),
      },
      {
        find: /^@alga-psa\/db\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../db/src/lib')}/$1`,
      },
      {
        find: /^@alga-psa\/db$/,
        replacement: path.resolve(__dirname, '../db/src/index.ts'),
      },
      {
        find: /^@alga-psa\/workflow-streams$/,
        replacement: path.resolve(__dirname, '../workflow-streams/src/streams/index.ts'),
      },
      {
        find: /^@alga-psa\/shared\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../../shared')}/$1`,
      },
      {
        find: /^@alga-psa\/product-extension-actions$/,
        replacement: path.resolve(__dirname, '../product-extension-actions/oss/entry.ts'),
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
        find: 'next/server',
        replacement: path.resolve(__dirname, '../../server/src/test/stubs/next-server.ts'),
      },
    ],
  },
});
