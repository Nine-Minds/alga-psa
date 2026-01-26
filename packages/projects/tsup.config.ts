import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Buildable code only - models, lib utilities, schemas, types
    // Actions and components with 'use server'/'use client' directives are runtime (Next.js transpiled)
    'index': 'src/index.ts',
    'models/index': 'src/models/index.ts',
    'models/project': 'src/models/project.ts',
    'models/projectTask': 'src/models/projectTask.ts',
    'models/taskDependency': 'src/models/taskDependency.ts',
    'models/taskType': 'src/models/taskType.ts',
    'lib/orderingUtils': 'src/lib/orderingUtils.ts',
    'schemas/project.schemas': 'src/schemas/project.schemas.ts',
    'schemas/projectTemplate.schemas': 'src/schemas/projectTemplate.schemas.ts',
    'types/templateWizard': 'src/types/templateWizard.ts',
    // Note: lib/orderingService.ts and lib/projectUtils.ts contain 'use server' - they are runtime-only
    // Note: All action files contain 'use server' - they are runtime-only
    // Note: All component files contain 'use client' - they are runtime-only
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
    /^@shared\/.*/,
    'knex',
    'uuid',
    'zod',
    'fractional-indexing',
    'date-fns',
    'lodash',
  ],
});
