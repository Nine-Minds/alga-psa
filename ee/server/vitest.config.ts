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

      // Match tsconfig-style subpath overrides before the generic `@/` mapping.
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

      // Convenience aliases used by tests/code.
      { find: '@main-server', replacement: path.resolve(__dirname, '../../server/src') },
      { find: '@main-test-utils', replacement: path.resolve(__dirname, '../../server/test-utils') },
      { find: 'server', replacement: path.resolve(__dirname, '../../server') },

      // Next.js server stubs for non-Next test runtime (required by next-auth env helpers).
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
