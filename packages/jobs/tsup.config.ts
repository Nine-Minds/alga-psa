import { defineConfig } from 'tsup';

// One self-contained file per subpath export so the package's exports map
// (./handlers/*, ./fanout, ./handler-utils/*, ./actions, ./hooks,
// ./components, .) resolves to matching dist/ files. Each entry is bundled
// (internal relative imports inlined) so the emitted .mjs is valid Node ESM
// without extension rewriting, while every other @alga-psa/* and @shared/*
// package stays external — those are resolved from node_modules at runtime
// (the temporal worker and the Next.js server both provide them).
export default defineConfig({
  entry: [
    'src/index.ts',
    'src/actions/index.ts',
    'src/components/index.ts',
    'src/hooks/index.ts',
    'src/lib/fanout/index.ts',
    'src/lib/handlers/*.ts',
    'src/lib/handler-utils/*.ts',
    'src/lib/jobRunnerAccessor.ts',
    'src/lib/jobSchedulerAccessor.ts',
    'src/lib/jobService.ts',
    'src/types/job.ts',
    '!src/**/*.test.ts',
    '!src/**/*.test.tsx',
    '!src/**/__tests__/**',
  ],
  format: ['esm', 'cjs'],
  dts: false,
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  external: [
    'react',
    'react-dom',
    'next',
    /^@alga-psa\//,
    /^@shared\//,
    // TODO(jobs-extraction): a few handlers still reach into server-only modules
    // (getJobRunner from server/src/lib/jobs/JobRunnerFactory, initializeScheduler
    // from server/src/lib/jobs/index). Keep server/* external so the package build
    // does not pull the server graph in; these are resolved at runtime on the
    // server and remain TODO'd until JobRunnerFactory/scheduler move into @alga-psa/jobs.
    /^server\//,
  ],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
