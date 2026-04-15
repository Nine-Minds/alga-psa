import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    globalSetup: ['./vitest.globalSetup.js'],
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
    testTimeout: 30000, // Increased for integration tests
    include: [
      'src/__tests__/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'src/__tests__/**/*.playwright.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'src/components/**/__tests__/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'
    ]
  },
  resolve: {
    alias: [
      // EE alias used in code/tests.
      { find: /^@ee\/(.*)$/, replacement: `${path.resolve(__dirname, './src')}/$1` },
      { find: /^@enterprise$/, replacement: `${path.resolve(__dirname, '../../packages/ee/src/index.ts')}` },
      { find: /^@enterprise\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/ee/src')}/$1` },

      // Match tsconfig-style subpath overrides before the generic `@/` mapping.
      { find: /^@\/lib\/db\/index$/, replacement: `${path.resolve(__dirname, '../../server/src/lib/db/index.ts')}` },
      { find: /^@\/config\/(.*)$/, replacement: `${path.resolve(__dirname, '../../server/src/config')}/$1` },
      { find: /^@\/utils\/(.*)$/, replacement: `${path.resolve(__dirname, '../../server/src/utils')}/$1` },
      { find: /^@\/interfaces\/(.*)$/, replacement: `${path.resolve(__dirname, '../../server/src/interfaces')}/$1` },
      { find: /^@\/models\/(.*)$/, replacement: `${path.resolve(__dirname, '../../server/src/models')}/$1` },
      { find: /^@\/services\/(.*)$/, replacement: `${path.resolve(__dirname, '../../server/src/services')}/$1` },
      { find: /^@\/hooks\/(.*)$/, replacement: `${path.resolve(__dirname, '../../server/src/hooks')}/$1` },
      { find: /^@\/constants\/(.*)$/, replacement: `${path.resolve(__dirname, '../../server/src/constants')}/$1` },
      { find: /^@\/context\/(.*)$/, replacement: `${path.resolve(__dirname, '../../server/src/context')}/$1` },
      { find: /^@\/middleware\/(.*)$/, replacement: `${path.resolve(__dirname, '../../server/src/middleware')}/$1` },
      { find: /^@\/pages\/(.*)$/, replacement: `${path.resolve(__dirname, '../../server/src/pages')}/$1` },
      { find: /^@\/components\/(.*)$/, replacement: `${path.resolve(__dirname, '../../server/src/components')}/$1` },

      // Generic `@/` => EE source root.
      { find: /^@\//, replacement: `${path.resolve(__dirname, './src')}/` },

      // Root shared + server imports.
      { find: /^@shared\/(.*)$/, replacement: `${path.resolve(__dirname, '../../shared')}/$1` },
      { find: /^@alga-psa\/shared\/(.*)$/, replacement: `${path.resolve(__dirname, '../../shared')}/$1` },
      { find: /^@alga-psa\/ui\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/ui/src')}/$1` },
      { find: /^@alga-psa\/ui$/, replacement: `${path.resolve(__dirname, '../../packages/ui/src/index.ts')}` },
      { find: /^@alga-psa\/billing$/, replacement: `${path.resolve(__dirname, '../../packages/billing/src/index.ts')}` },
      { find: /^@alga-psa\/billing\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/billing/src')}/$1` },
      { find: /^@alga-psa\/tenancy\/actions$/, replacement: `${path.resolve(__dirname, '../../packages/tenancy/src/actions/index.ts')}` },
      { find: /^@alga-psa\/tags$/, replacement: `${path.resolve(__dirname, '../../packages/tags/src/index.ts')}` },
      { find: /^@alga-psa\/tags\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/tags/src')}/$1` },
      { find: /^@alga-psa\/integrations$/, replacement: `${path.resolve(__dirname, '../../packages/integrations/src/index.ts')}` },
      { find: /^@alga-psa\/integrations\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/integrations/src')}/$1` },
      { find: /^@alga-psa\/event-bus$/, replacement: `${path.resolve(__dirname, '../../packages/event-bus/src/index.ts')}` },
      { find: /^@alga-psa\/event-bus\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/event-bus/src')}/$1` },
      { find: /^@alga-psa\/scheduling$/, replacement: `${path.resolve(__dirname, '../../packages/scheduling/src/index.ts')}` },
      { find: /^@alga-psa\/scheduling\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/scheduling/src')}/$1` },
      { find: /^@alga-psa\/documents$/, replacement: `${path.resolve(__dirname, '../../packages/documents/src/index.ts')}` },
      { find: /^@alga-psa\/documents\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/documents/src')}/$1` },
      { find: /^@alga-psa\/storage$/, replacement: `${path.resolve(__dirname, '../../packages/storage/src/index.ts')}` },
      { find: /^@alga-psa\/storage\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/storage/src')}/$1` },
      { find: /^@alga-psa\/ee-stubs$/, replacement: `${path.resolve(__dirname, './src/index.ts')}` },
      { find: /^@alga-psa\/ee-stubs\/(.*)$/, replacement: `${path.resolve(__dirname, './src')}/$1` },
      { find: /^@alga-psa\/clients$/, replacement: `${path.resolve(__dirname, '../../packages/clients/src/index.ts')}` },
      { find: /^@alga-psa\/clients\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/clients/src')}/$1` },
      { find: /^@alga-psa\/tickets$/, replacement: `${path.resolve(__dirname, '../../packages/tickets/src/index.ts')}` },
      { find: /^@alga-psa\/tickets\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/tickets/src')}/$1` },
      { find: /^@alga-psa\/projects$/, replacement: `${path.resolve(__dirname, '../../packages/projects/src/index.ts')}` },
      { find: /^@alga-psa\/projects\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/projects/src')}/$1` },
      { find: /^@alga-psa\/teams$/, replacement: `${path.resolve(__dirname, '../../packages/teams/src/index.ts')}` },
      { find: /^@alga-psa\/teams\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/teams/src')}/$1` },
      { find: /^@alga-psa\/assets$/, replacement: `${path.resolve(__dirname, '../../packages/assets/src/index.ts')}` },
      { find: /^@alga-psa\/assets\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/assets/src')}/$1` },
      { find: /^@alga-psa\/surveys$/, replacement: `${path.resolve(__dirname, '../../packages/surveys/src/index.ts')}` },
      { find: /^@alga-psa\/surveys\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/surveys/src')}/$1` },
      { find: /^@alga-psa\/notifications$/, replacement: `${path.resolve(__dirname, '../../packages/notifications/src/index.ts')}` },
      { find: /^@alga-psa\/notifications\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/notifications/src')}/$1` },
      { find: /^@alga-psa\/product-extension-actions$/, replacement: `${path.resolve(__dirname, '../../packages/product-extension-actions/oss/entry.ts')}` },
      { find: /^@alga-psa\/user-composition$/, replacement: `${path.resolve(__dirname, '../../packages/user-composition/src/index.ts')}` },
      { find: /^@alga-psa\/user-composition\/actions$/, replacement: `${path.resolve(__dirname, '../../packages/user-composition/src/actions/index.ts')}` },
      { find: /^@alga-psa\/user-composition\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/user-composition/src')}/$1` },
      { find: /^@alga-psa\/types$/, replacement: `${path.resolve(__dirname, '../../packages/types/src/index.ts')}` },
      { find: /^@alga-psa\/types\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/types/src')}/$1` },
      { find: /^@alga-psa\/validation$/, replacement: `${path.resolve(__dirname, '../../packages/validation/src/index.ts')}` },
      { find: /^@alga-psa\/validation\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/validation/src')}/$1` },
      { find: /^@alga-psa\/auth$/, replacement: `${path.resolve(__dirname, '../../packages/auth/src/index.ts')}` },
      { find: /^@alga-psa\/auth\/sso\/entry$/, replacement: `${path.resolve(__dirname, '../../packages/auth/src/components/SsoProviderButtons.tsx')}` },
      { find: /^@alga-psa\/auth\/session$/, replacement: `${path.resolve(__dirname, '../../packages/auth/src/lib/session.ts')}` },
      { find: /^@alga-psa\/auth\/rbac$/, replacement: `${path.resolve(__dirname, '../../packages/auth/src/lib/rbac.ts')}` },
      { find: /^@alga-psa\/auth\/withAuth$/, replacement: `${path.resolve(__dirname, '../../packages/auth/src/lib/withAuth.ts')}` },
      { find: /^@alga-psa\/auth\/apiAuth$/, replacement: `${path.resolve(__dirname, '../../packages/auth/src/lib/apiAuth.ts')}` },
      { find: /^@alga-psa\/auth\/types\/next-auth$/, replacement: `${path.resolve(__dirname, '../../packages/auth/src/types/next-auth.ts')}` },
      { find: /^@alga-psa\/auth\/lib\/sso\/mspSsoResolution$/, replacement: `${path.resolve(__dirname, '../../packages/auth/src/lib/sso/mspSsoResolution.ts')}` },
      { find: /^@alga-psa\/auth\/deviceFingerprint$/, replacement: `${path.resolve(__dirname, '../../packages/auth/src/lib/deviceFingerprint.ts')}` },
      { find: /^@alga-psa\/auth\/ipAddress$/, replacement: `${path.resolve(__dirname, '../../packages/auth/src/lib/ipAddress.ts')}` },
      { find: /^@alga-psa\/auth\/geolocation$/, replacement: `${path.resolve(__dirname, '../../packages/auth/src/lib/geolocation.ts')}` },
      { find: /^@alga-psa\/auth\/twoFactorHelpers$/, replacement: `${path.resolve(__dirname, '../../packages/auth/src/lib/twoFactorHelpers.ts')}` },
      { find: /^@alga-psa\/auth\/lib\/mspRememberedEmail$/, replacement: `${path.resolve(__dirname, '../../packages/auth/src/lib/mspRememberedEmail.ts')}` },
      { find: /^@alga-psa\/auth\/nextAuthOptions$/, replacement: `${path.resolve(__dirname, '../../packages/auth/src/lib/nextAuthOptions.ts')}` },
      { find: /^@alga-psa\/auth\/getCurrentUser$/, replacement: `${path.resolve(__dirname, '../../packages/auth/src/lib/getCurrentUser.ts')}` },
      { find: /^@alga-psa\/auth\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/auth/src')}/$1` },
      { find: /^@alga-psa\/analytics$/, replacement: `${path.resolve(__dirname, '../../packages/analytics/src/index.ts')}` },
      { find: /^@alga-psa\/analytics\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/analytics/src')}/$1` },
      { find: /^@alga-psa\/event-schemas$/, replacement: `${path.resolve(__dirname, '../../packages/event-schemas/src/index.ts')}` },
      { find: /^@alga-psa\/event-schemas\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/event-schemas/src')}/$1` },
      { find: /^@alga-psa\/core\/server$/, replacement: `${path.resolve(__dirname, '../../packages/core/src/server.ts')}` },
      { find: /^@alga-psa\/core\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/core/src/lib')}/$1` },
      { find: /^@alga-psa\/core$/, replacement: `${path.resolve(__dirname, '../../packages/core/src/index.ts')}` },
      { find: /^@alga-psa\/db\/admin$/, replacement: `${path.resolve(__dirname, '../../packages/db/src/lib/admin.ts')}` },
      { find: /^@alga-psa\/db\/models$/, replacement: `${path.resolve(__dirname, '../../packages/db/src/models/index.ts')}` },
      { find: /^@alga-psa\/db\/models\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/db/src/models')}/$1` },
      { find: /^@alga-psa\/db\/(.*)$/, replacement: `${path.resolve(__dirname, '../../packages/db/src/lib')}/$1` },
      { find: /^@alga-psa\/db$/, replacement: `${path.resolve(__dirname, '../../packages/db/src/index.ts')}` },

      // Convenience aliases used by tests/code.
      { find: '@main-server', replacement: path.resolve(__dirname, '../../server/src') },
      { find: '@main-test-utils', replacement: path.resolve(__dirname, '../../server/test-utils') },
      { find: 'server', replacement: path.resolve(__dirname, '../../server') },

      // Next.js server stubs for non-Next test runtime (required by next-auth env helpers).
      { find: 'fs', replacement: 'node:fs' },
      { find: 'fs/promises', replacement: 'node:fs/promises' },
      { find: 'next/server', replacement: path.resolve(__dirname, '../../server/src/test/stubs/next-server.ts') },
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
      allow: [path.resolve(__dirname, '../..')],
    },
  },
});
