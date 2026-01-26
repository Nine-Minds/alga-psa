import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Buildable lib/models code only
    // Actions are runtime (Next.js transpiled)
    'index': 'src/index.ts',
    'lib/reports/index': 'src/lib/reports/index.ts',
    'lib/reports/core/index': 'src/lib/reports/core/index.ts',
    'lib/reports/core/ReportEngine': 'src/lib/reports/core/ReportEngine.ts',
    'lib/reports/core/ReportRegistry': 'src/lib/reports/core/ReportRegistry.ts',
    'lib/reports/core/types': 'src/lib/reports/core/types.ts',
    'lib/reports/builders/index': 'src/lib/reports/builders/index.ts',
    'lib/reports/builders/QueryBuilder': 'src/lib/reports/builders/QueryBuilder.ts',
    'lib/reports/definitions/index': 'src/lib/reports/definitions/index.ts',
    'lib/reports/definitions/billing/index': 'src/lib/reports/definitions/billing/index.ts',
    'lib/reports/definitions/billing/overview': 'src/lib/reports/definitions/billing/overview.ts',
    'lib/reports/definitions/contracts/index': 'src/lib/reports/definitions/contracts/index.ts',
    'lib/reports/definitions/contracts/bucket-usage': 'src/lib/reports/definitions/contracts/bucket-usage.ts',
    'lib/reports/definitions/contracts/expiration': 'src/lib/reports/definitions/contracts/expiration.ts',
    'lib/reports/definitions/contracts/profitability': 'src/lib/reports/definitions/contracts/profitability.ts',
    'lib/reports/definitions/contracts/revenue': 'src/lib/reports/definitions/contracts/revenue.ts',
    'models/creditReconciliationReport': 'src/models/creditReconciliationReport.ts',
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
  ],
});
