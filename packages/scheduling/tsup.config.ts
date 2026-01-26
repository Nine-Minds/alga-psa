import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Buildable code only - no 'use server' or 'use client' directives
    // Runtime code (actions, components) is transpiled by Next.js directly from src/
    'index': 'src/index.ts',
    'models/index': 'src/models/index.ts',
    'lib/capacityThresholdMath': 'src/lib/capacityThresholdMath.ts',
    'lib/capacityThresholdWorkflowEvents': 'src/lib/capacityThresholdWorkflowEvents.ts',
    'lib/timePeriodSuggester': 'src/lib/timePeriodSuggester.ts',
    'schemas/appointmentRequestSchemas': 'src/schemas/appointmentRequestSchemas.ts',
    'schemas/appointmentSchemas': 'src/schemas/appointmentSchemas.ts',
    'schemas/timeSheet.schemas': 'src/schemas/timeSheet.schemas.ts',
    'services/bucketUsageService': 'src/services/bucketUsageService.ts',
    'utils/icsGenerator': 'src/utils/icsGenerator.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  bundle: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  external: [
    /^@alga-psa\/.*/,
    'knex',
    'react',
    'react-dom',
    'next',
    'next/navigation',
    'uuid',
    'zod',
    'date-fns',
    'date-fns-tz',
    '@js-temporal/polyfill',
    '@shared/workflow/streams/domainEventBuilders/capacityThresholdEventBuilders',
  ],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
