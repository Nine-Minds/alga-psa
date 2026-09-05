import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    passWithNoTests: true,
    testTimeout: 10000,
    // Inline next-auth/@auth/core/next so vite transforms them and the
    // next/server alias below actually applies to next-auth's internal import.
    server: {
      deps: {
        inline: ['next-auth', '@auth/core', 'next'],
      },
    },
  },
  resolve: {
    // Mirrors packages/projects. Without these, any suite that imports the real
    // @alga-psa/auth chain dies at collection ("Cannot find package …") and the
    // whole file is reported as failed having run nothing — the marketing and
    // opportunity suites were dead for exactly this reason.
    alias: [
      { find: /^next\/server$/, replacement: path.resolve(__dirname, '../../node_modules/next/server.js') },
      { find: /^@alga-psa\/types$/, replacement: path.resolve(__dirname, '../types/src/index.ts') },
      { find: /^@alga-psa\/types\/(.*)$/, replacement: `${path.resolve(__dirname, '../types/src')}/$1` },
      { find: /^@alga-psa\/user-activities\/(.*)$/, replacement: `${path.resolve(__dirname, 'src')}/$1` },
      { find: /^@alga-psa\/ui$/, replacement: path.resolve(__dirname, '../ui/src/index.ts') },
      // @alga-psa/db's exports put tenant/admin/connection under src/lib and
      // models under src/models, so they precede the generic rule below.
      { find: /^@alga-psa\/db\/models$/, replacement: path.resolve(__dirname, '../db/src/models/index.ts') },
      { find: /^@alga-psa\/db\/models\/(.*)$/, replacement: `${path.resolve(__dirname, '../db/src/models')}/$1` },
      { find: /^@alga-psa\/db\/(.*)$/, replacement: `${path.resolve(__dirname, '../db/src/lib')}/$1` },
      {
        find: /^@alga-psa\/auth\/sso\/entry$/,
        replacement: path.resolve(__dirname, '../auth/src/components/SsoProviderButtons.tsx'),
      },
      { find: /^@alga-psa\/auth$/, replacement: path.resolve(__dirname, '../auth/src/index.ts') },
      { find: /^@alga-psa\/auth\/session$/, replacement: path.resolve(__dirname, '../auth/src/lib/session.ts') },
      { find: /^@alga-psa\/auth\/rbac$/, replacement: path.resolve(__dirname, '../auth/src/lib/rbac.ts') },
      { find: /^@alga-psa\/auth\/withAuth$/, replacement: path.resolve(__dirname, '../auth/src/lib/withAuth.ts') },
      { find: /^@alga-psa\/auth\/apiAuth$/, replacement: path.resolve(__dirname, '../auth/src/lib/apiAuth.ts') },
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
      { find: /^@alga-psa\/auth\/(.*)$/, replacement: `${path.resolve(__dirname, '../auth/src')}/$1` },
      {
        find: /^@alga-psa\/product-extension-actions$/,
        replacement: path.resolve(__dirname, '../product-extension-actions/oss/entry.ts'),
      },
      { find: /^@alga-psa\/shared\/(.*)$/, replacement: `${path.resolve(__dirname, '../../shared')}/$1` },
      { find: /^@enterprise$/, replacement: path.resolve(__dirname, '../ee/src/index.ts') },
      { find: /^@enterprise\/(.*)$/, replacement: `${path.resolve(__dirname, '../ee/src')}/$1` },
      // Generic workspace fallback: resolve from src so tests never depend on
      // built dist output.
      { find: /^@alga-psa\/([^/]+)\/(.*)$/, replacement: `${path.resolve(__dirname, '..')}/$1/src/$2` },
      { find: /^@alga-psa\/([^/]+)$/, replacement: `${path.resolve(__dirname, '..')}/$1/src` },
      { find: /^@shared\/(.*)$/, replacement: `${path.resolve(__dirname, '../../shared')}/$1` },
      { find: '@shared', replacement: path.resolve(__dirname, '../../shared') },
    ],
  },
});
