import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Buildable lib/types code only
    // Actions, components, and hooks are runtime (Next.js transpiled)
    'index': 'src/index.ts',
    'lib/jobService': 'src/lib/jobService.ts',
    'lib/jobs/interfaces/index': 'src/lib/jobs/interfaces/index.ts',
    'lib/jobs/interfaces/IJobRunner': 'src/lib/jobs/interfaces/IJobRunner.ts',
    'lib/jobs/interfaces/IJobRunnerFactory': 'src/lib/jobs/interfaces/IJobRunnerFactory.ts',
    'lib/jobs/jobHandlerRegistry': 'src/lib/jobs/jobHandlerRegistry.ts',
    'lib/jobs/jobScheduler': 'src/lib/jobs/jobScheduler.ts',
    'types/job': 'src/types/job.ts',
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
    '@alga-psa/ui',
    '@alga-psa/validation',
    'date-fns',
    'knex',
    'lucide-react',
    'uuid',
    'zod',
    'react',
    'react-dom',
  ],
});
