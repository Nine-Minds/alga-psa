import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test-utils/setup.ts'],
    testTimeout: 120000, // 2 minutes for E2E tests
    hookTimeout: 60000, // 1 minute for setup/teardown
    pool: 'forks', // Required for Temporal tests
    poolOptions: {
      forks: {
        singleFork: true, // Prevent issues with concurrent Temporal environments
      },
    },
    // Different configurations for different test types
    env: {
      NODE_ENV: 'test',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.d.ts',
        'src/test-utils/**',
        'src/__tests__/**',
        'scripts/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../../shared'),
      '@alga-psa/shared': path.resolve(__dirname, '../../shared'),
    },
  },
});