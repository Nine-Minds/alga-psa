import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Buildable models/services code only
    // Actions and components are runtime (Next.js transpiled)
    'index': 'src/index.ts',
    'models/index': 'src/models/index.ts',
    'services/SurveyAnalyticsService': 'src/services/SurveyAnalyticsService.ts',
    'services/SurveyDashboardService': 'src/services/SurveyDashboardService.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  bundle: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  external: [
    '@alga-psa/core',
    '@alga-psa/db',
    '@alga-psa/types',
    '@alga-psa/validation',
    'knex',
    'uuid',
    'zod',
    'react',
    'react-dom',
  ],
});
