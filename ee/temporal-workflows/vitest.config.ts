import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test-utils/setup.ts'],
    testTimeout: 60000, // 1 minute for E2E tests
    hookTimeout: 30000, // 30 seconds for setup/teardown
    pool: 'forks', // Required for Temporal tests
    poolOptions: {
      forks: {
        singleFork: true, // Prevent issues with concurrent Temporal environments
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.d.ts',
        'src/test-utils/**',
        'scripts/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../../shared'),
    },
  },
});