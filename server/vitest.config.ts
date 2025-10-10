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
        path.resolve(__dirname, '../packages/product-extension-storage-api/**/*.{js,ts,jsx,tsx}'),
      ],
      reportsDirectory: path.resolve(__dirname, './coverage'),
      reporter: ['text', 'html', 'lcov'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared'),
      'next/server': path.resolve(__dirname, './src/test/stubs/next-server.ts'),
      '@product/extension-storage-api/ee/record-impl': path.resolve(
        __dirname,
        '../packages/product-extension-storage-api/ee/record-impl.ts',
      ),
      '@product/extension-storage-api/ee/records-impl': path.resolve(
        __dirname,
        '../packages/product-extension-storage-api/ee/records-impl.ts',
      ),
      '@product/extension-storage-api/record': path.resolve(
        __dirname,
        '../packages/product-extension-storage-api/record.ts',
      ),
      '@product/extension-storage-api/records': path.resolve(
        __dirname,
        '../packages/product-extension-storage-api/records.ts',
      ),
    },
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
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
  ssr: {
    noExternal: [/^@product\/extension-storage-api(\/.*)?$/],
  },
});
