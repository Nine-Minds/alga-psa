import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [path.resolve(__dirname, './src/test/setup.ts')],
    globalSetup: [path.resolve(__dirname, './vitest.globalSetup.js')],
    isolate: true,
    sequence: {
      concurrent: false,
      shuffle: true
    },
    pool: 'forks',
    poolOptions: {
      threads: {
        singleThread: true
      },
      forks: {
        singleFork: true
      }
    },
    logHeapUsage: true,
    testTimeout: 20000,
    coverage: {
      enabled: true,
      provider: 'v8',
      include: [
        'src/**/*.{js,ts,jsx,tsx}',
      ],
      reportsDirectory: path.resolve(__dirname, './coverage'),
      reporter: ['text', 'html', 'lcov'],
    },
  },
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      { find: '@ee', replacement: path.resolve(__dirname, '../ee/server/src') },
      { find: '@shared', replacement: path.resolve(__dirname, '../shared') },
      { find: '@alga-psa/shared', replacement: path.resolve(__dirname, '../shared') },

      // Workspace packages are not guaranteed to be linked into node_modules in all dev/test setups.
      // Explicitly alias the most common @alga-psa/* modules to their source entrypoints for Vitest.
      { find: /^@alga-psa\/core$/, replacement: path.resolve(__dirname, '../packages/core/src/index.ts') },
      { find: /^@alga-psa\/core\/logger$/, replacement: path.resolve(__dirname, '../packages/core/src/lib/logger.ts') },
      { find: /^@alga-psa\/core\/secrets$/, replacement: path.resolve(__dirname, '../packages/core/src/lib/secrets/index.ts') },
      { find: /^@alga-psa\/core\/events$/, replacement: path.resolve(__dirname, '../packages/core/src/lib/events/index.ts') },
      { find: /^@alga-psa\/core\/encryption$/, replacement: path.resolve(__dirname, '../packages/core/src/lib/encryption.ts') },

      { find: /^@alga-psa\/db$/, replacement: path.resolve(__dirname, '../packages/db/src/index.ts') },
      { find: /^@alga-psa\/db\/admin$/, replacement: path.resolve(__dirname, '../packages/db/src/lib/admin.ts') },
      { find: /^@alga-psa\/db\/tenant$/, replacement: path.resolve(__dirname, '../packages/db/src/lib/tenant.ts') },
      { find: /^@alga-psa\/db\/connection$/, replacement: path.resolve(__dirname, '../packages/db/src/lib/connection.ts') },

      { find: /^@alga-psa\/types$/, replacement: path.resolve(__dirname, '../packages/types/src/index.ts') },
      { find: /^@alga-psa\/validation$/, replacement: path.resolve(__dirname, '../packages/validation/src/index.ts') },
      { find: /^@alga-psa\/auth$/, replacement: path.resolve(__dirname, '../packages/auth/src/index.ts') },
      { find: /^@alga-psa\/auth\/session$/, replacement: path.resolve(__dirname, '../packages/auth/src/lib/session.ts') },
      { find: /^@alga-psa\/auth\/rbac$/, replacement: path.resolve(__dirname, '../packages/auth/src/lib/rbac.ts') },
      { find: /^@alga-psa\/auth\/apiAuth$/, replacement: path.resolve(__dirname, '../packages/auth/src/lib/apiAuth.ts') },
      { find: /^@alga-psa\/auth\/deviceFingerprint$/, replacement: path.resolve(__dirname, '../packages/auth/src/lib/deviceFingerprint.ts') },
      { find: /^@alga-psa\/auth\/ipAddress$/, replacement: path.resolve(__dirname, '../packages/auth/src/lib/ipAddress.ts') },
      { find: /^@alga-psa\/auth\/geolocation$/, replacement: path.resolve(__dirname, '../packages/auth/src/lib/geolocation.ts') },
      { find: /^@alga-psa\/auth\/twoFactorHelpers$/, replacement: path.resolve(__dirname, '../packages/auth/src/lib/twoFactorHelpers.ts') },
      { find: /^@alga-psa\/auth\/nextAuthOptions$/, replacement: path.resolve(__dirname, '../packages/auth/src/lib/nextAuthOptions.ts') },
      { find: /^@alga-psa\/auth\/getCurrentUser$/, replacement: path.resolve(__dirname, '../packages/auth/src/lib/getCurrentUser.ts') },
      { find: /^@alga-psa\/ui$/, replacement: path.resolve(__dirname, '../packages/ui/src/index.ts') },
      { find: /^@alga-psa\/ui\/(.*)$/, replacement: path.resolve(__dirname, '../packages/ui/src/$1') },
      { find: /^@alga-psa\/tickets$/, replacement: path.resolve(__dirname, '../packages/tickets/src/index.ts') },
      { find: /^@alga-psa\/tickets\/(.*)$/, replacement: path.resolve(__dirname, '../packages/tickets/src/$1') },
      { find: /^@alga-psa\/scheduling$/, replacement: path.resolve(__dirname, '../packages/scheduling/src/index.ts') },
      { find: /^@alga-psa\/scheduling\/(.*)$/, replacement: path.resolve(__dirname, '../packages/scheduling/src/$1') },
      { find: /^@alga-psa\/workflows$/, replacement: path.resolve(__dirname, '../packages/workflows/src/index.ts') },
      { find: /^@alga-psa\/workflows\/(.*)$/, replacement: path.resolve(__dirname, '../packages/workflows/src/$1') },
      { find: /^@alga-psa\/documents$/, replacement: path.resolve(__dirname, '../packages/documents/src/index.ts') },
      { find: /^@alga-psa\/documents\/(.*)$/, replacement: path.resolve(__dirname, '../packages/documents/src/$1') },
      { find: /^@alga-psa\/assets$/, replacement: path.resolve(__dirname, '../packages/assets/src/index.ts') },
      { find: /^@alga-psa\/assets\/(.*)$/, replacement: path.resolve(__dirname, '../packages/assets/src/$1') },
      { find: /^@alga-psa\/surveys$/, replacement: path.resolve(__dirname, '../packages/surveys/src/index.ts') },
      { find: /^@alga-psa\/surveys\/(.*)$/, replacement: path.resolve(__dirname, '../packages/surveys/src/$1') },
      { find: /^@alga-psa\/integrations$/, replacement: path.resolve(__dirname, '../packages/integrations/src/index.ts') },
      { find: /^@alga-psa\/integrations\/(.*)$/, replacement: path.resolve(__dirname, '../packages/integrations/src/$1') },
      { find: /^@alga-psa\/client-portal$/, replacement: path.resolve(__dirname, '../packages/client-portal/src/index.ts') },
      { find: /^@alga-psa\/client-portal\/(.*)$/, replacement: path.resolve(__dirname, '../packages/client-portal/src/$1') },

      { find: 'fs', replacement: 'node:fs' },
      { find: 'fs/promises', replacement: 'node:fs/promises' },
      { find: 'next/server', replacement: path.resolve(__dirname, './src/test/stubs/next-server.ts') },
      { find: 'pdf-lib', replacement: 'empty-module' },
    ],
  },
  server: {
    deps: {
      inline: [
        'next-auth',
        '@auth/core',
        'next',
      ],
    },
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
  ssr: {
    noExternal: [],
  },
});
