import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Server-side entry point (buildable)
    'index': 'src/index.ts',
    // Supporting modules
    'events': 'src/events.ts',
    'posthog': 'src/posthog.ts',
    'config/posthog.config': 'src/config/posthog.config.ts',
    'lib/featureAdoption': 'src/lib/featureAdoption.ts',
    'lib/adapters/serverAnalyticsTracker': 'src/lib/adapters/serverAnalyticsTracker.ts',
    'analyticsSettings': 'src/analyticsSettings.ts',
    'analyticsSettingsServer': 'src/analyticsSettingsServer.ts',
    'utils/version': 'src/utils/version.ts',
    'terminal-notice': 'src/terminal-notice.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  bundle: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  external: [
    '@alga-psa/db',
    '@alga-psa/tenancy',
    'posthog-node',
    'uuid',
    'zod',
  ],
});
