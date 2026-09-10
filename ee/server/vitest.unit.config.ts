import { defineConfig } from 'vitest/config';
import eeConfig from './vitest.config';
import serverConfig from '../../server/vitest.config';

// The historical EE target mixes unit, database and browser suites. Keep the
// unit job independently runnable; other runtimes need their own execution lanes.
export default defineConfig({
  ...eeConfig,
  esbuild: { jsx: 'automatic' },
  resolve: {
    ...eeConfig.resolve,
    alias: [
      ...(eeConfig.resolve?.alias as any[]),
      ...(serverConfig.resolve?.alias as any[]),
    ],
  },
  test: {
    ...eeConfig.test,
    include: [
      'src/__tests__/unit/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/__tests__/services/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/components/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '../packages/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    exclude: [
      '**/node_modules/**', '**/dist/**',
      '**/*.integration.{test,spec}.?(c|m)[jt]s?(x)',
      '**/*.db.{test,spec}.?(c|m)[jt]s?(x)',
      '**/*.playwright.{test,spec}.?(c|m)[jt]s?(x)',
      '../**/node_modules/**', '../**/dist/**',
      '../**/*.integration.{test,spec}.?(c|m)[jt]s?(x)',
      '../**/*.db.{test,spec}.?(c|m)[jt]s?(x)',
      '../**/*.playwright.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    coverage: { enabled: false },
    fileParallelism: false,
    maxWorkers: 1,
    poolOptions: { forks: { singleFork: false } },
    sequence: { concurrent: false, shuffle: false },
  },
});
