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
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@ee': path.resolve(__dirname, '../ee/server/src'),
      '@shared': path.resolve(__dirname, '../shared'),
      '@alga-psa/shared': path.resolve(__dirname, '../shared'),
      fs: 'node:fs',
      'fs/promises': 'node:fs/promises',
      'next/server': path.resolve(__dirname, './src/test/stubs/next-server.ts'),
      'pdf-lib': 'empty-module',
    },
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
