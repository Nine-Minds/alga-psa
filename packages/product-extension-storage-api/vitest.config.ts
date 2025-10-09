import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  root: __dirname,
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: [path.resolve(__dirname, '../../server/src/test/setup.ts')],
    globalSetup: [path.resolve(__dirname, '../../server/vitest.globalSetup.js')],
    deps: {
      inline: ['next-auth', '@auth/core', 'next'],
    },
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../../server/src'),
      'next/server': path.resolve(__dirname, '../../node_modules/next/server.js'),
    },
  },
});
