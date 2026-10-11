import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'node:path';

export default defineConfig({
  plugins: [tsconfigPaths({ ignoreConfigErrors: true })],
  resolve: {
    alias: [
      { find: /^next\/server$/, replacement: path.resolve(__dirname, '../../node_modules/next/server.js') },
      {
        find: /^@alga-psa\/product-extension-actions$/,
        replacement: path.resolve(__dirname, '../product-extension-actions/oss/entry.ts'),
      },
    ],
  },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    sequence: { concurrent: false, shuffle: false },
    coverage: { enabled: false },
    // 20s, matching the other heavy action-layer packages (billing, tickets,
    // client-portal, integrations, scheduling). Mock factories here close over
    // hoisted doubles, so tests defer to `await import(...)` inside the test
    // body; the first test to do so pays the entire cold transform of the
    // action's module graph — 1.7s idle for interactionActions once co-managed
    // joined it — while every later test in the file runs in ~1ms. Three Nx
    // tasks share the CI runner, and that first import blew the 5s default.
    testTimeout: 20000,
    // Inline next-auth/@auth/core/next so vite transforms them and the
    // next/server alias below applies to next-auth's internal `import
    // "next/server"`. Mirrors the billing package config.
    server: {
      deps: {
        inline: ['next-auth', '@auth/core', 'next'],
      },
    },
  },
});
