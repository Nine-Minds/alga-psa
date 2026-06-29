import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    sequence: { concurrent: false, shuffle: false },
    coverage: { enabled: false },
  },
  resolve: {
    alias: [
      // next-auth's lib/env.js does `import { NextRequest } from "next/server"`;
      // under a fresh CI install vite can't resolve the extensionless builtin
      // specifier ("Cannot find module next/server ... Did you mean next/server.js?"),
      // which collapsed the TaskForm* suites. Point it at the real file, matching
      // the alias tickets/integrations already carry.
      { find: /^next\/server$/, replacement: path.resolve(__dirname, '../../node_modules/next/server.js') },
      { find: /^@alga-psa\/types$/, replacement: path.resolve(__dirname, '../types/src/index.ts') },
      { find: /^@alga-psa\/types\/(.*)$/, replacement: path.resolve(__dirname, '../types/src/$1') },
      // Resolve workspace packages (including self-references) from src so
      // tests do not depend on built dist output.
      { find: /^@alga-psa\/projects\/(.*)$/, replacement: `${path.resolve(__dirname, 'src')}/$1` },
      { find: /^@alga-psa\/ui$/, replacement: path.resolve(__dirname, '../ui/src/index.ts') },
      { find: /^@alga-psa\/db\/admin$/, replacement: path.resolve(__dirname, '../db/src/lib/admin.ts') },
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
      { find: /^@alga-psa\/([^/]+)\/(.*)$/, replacement: `${path.resolve(__dirname, '..')}/$1/src/$2` },
      { find: /^@alga-psa\/([^/]+)$/, replacement: `${path.resolve(__dirname, '..')}/$1/src` },
      { find: '@shared', replacement: path.resolve(__dirname, '../../shared') },
    ],
  },
});
