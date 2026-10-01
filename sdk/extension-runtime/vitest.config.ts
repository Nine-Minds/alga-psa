import { defineConfig } from 'vitest/config';

// Without a config of its own, `vitest` walks up to the repository root config
// (which is server/vitest.config.ts). That lane splits itself into `jsdom` and
// `node` projects whose excludes are the explicit file lists it globbed from
// the server lane, so files outside it — everything under sdk/ — are excluded
// from neither and run twice, once under jsdom. These suites read their
// fixtures with `new URL(..., import.meta.url)`, which stops being a file: URL
// under jsdom, so the jsdom copy failed with "The URL must be of scheme file".
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    passWithNoTests: true,
    testTimeout: 10000,
  },
});
