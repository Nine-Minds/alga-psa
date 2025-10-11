import { defineConfig } from 'vitest/config';
import path from 'path';

const root = path.resolve(__dirname, '../..');

export default defineConfig({
  root: root,
  test: {
    globals: true,
    environment: 'node',
    // Reuse the server test setup for Next.js stubs and session mocks
    setupFiles: [path.resolve(root, 'server/src/test/setup.ts')],
    // Enable coverage for this package by default
    coverage: {
      enabled: false, // Only enable via CLI flag --coverage to avoid exhausting VSCode's limit
      provider: 'v8',
      include: [
        '**/*.{ts,tsx,js,jsx}',
      ],
      exclude: [
        '**/node_modules/**',
        '**/test/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/vitest.config.ts',
      ],
      reportsDirectory: './coverage',
      reporter: ['text', 'html', 'lcov'],
    },
    server: {
      deps: {
        inline: [
          'next-auth',
          '@auth/core',
          'next',
          /^@product\/extension-storage-api(\/.*)?$/,
        ],
      },
    },
  },
  resolve: {
    alias: {
      // Alias Next server to the test stub used across the repo
      'next/server': path.resolve(root, 'server/src/test/stubs/next-server.ts'),
      // Map '@/...' used by helpers in server tests to server/src
      '@': path.resolve(root, 'server/src'),
      // Map '@shared' to the shared package
      '@shared': path.resolve(root, 'shared'),
    },
  },
  server: {
    fs: {
      allow: [root],
    },
  },
  ssr: {
    noExternal: [/^@product\/extension-storage-api(\/.*)?$/],
  },
});
