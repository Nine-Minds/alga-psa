import { defineConfig } from 'vitest/config';
import serverConfig from './vitest.config';

// The server's npm test command selects src/test/unit only. Tests beside
// routes, components, and services need a separate required execution path.
export default defineConfig({
  ...serverConfig,
  test: {
    ...serverConfig.test,
    include: [
      'src/app/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/components/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/lib/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/services/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/test/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    exclude: [
      '**/node_modules/**', '**/dist/**',
      '**/*.integration.{test,spec}.?(c|m)[jt]s?(x)',
      '**/*.db.{test,spec}.?(c|m)[jt]s?(x)',
      '**/*.playwright.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    coverage: { enabled: false },
    fileParallelism: false,
    maxWorkers: 1,
    poolOptions: { forks: { singleFork: false } },
  },
});
