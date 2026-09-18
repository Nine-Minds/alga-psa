import { defineConfig } from '@playwright/test';
import productionConfig from './playwright.config';

// Reuse customer journeys for quick host-server feedback. These reports are
// deliberately separate from production-image execution evidence.
export default defineConfig({
  ...productionConfig,
  retries: 0,
  // A first visit compiles the route on demand; production budgets stay in the
  // production config and are not relaxed by this development-only runner.
  timeout: 240_000,
  expect: { timeout: 90_000 },
  outputDir: './test-results/local/artifacts',
  reporter: [
    ['list'],
    ['html', { outputFolder: './test-results/local/report', open: 'never' }],
    ['json', { outputFile: './test-results/local/results.json' }],
  ],
  metadata: {
    ...productionConfig.metadata,
    serverLifecycle: 'externally-started-host-development-server',
    releaseValidation: false,
  },
});
