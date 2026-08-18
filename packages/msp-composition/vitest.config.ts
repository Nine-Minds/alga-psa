import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // Match Next's automatic JSX runtime so components can render without importing React.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    sequence: { concurrent: false, shuffle: false },
    coverage: { enabled: false },
  },
  resolve: {
    alias: [
      // The clients context subpath's package exports point its "import"
      // condition at a dist build this package's test runs do not produce;
      // resolve it to source like the other aliased workspace packages.
      { find: /^@alga-psa\/clients\/context\/ClientCrossFeatureContext$/, replacement: path.resolve(__dirname, '../clients/src/context/ClientCrossFeatureContext.tsx') },
      { find: /^@alga-psa\/ui$/, replacement: path.resolve(__dirname, '../ui/src/index.ts') },
      { find: /^@alga-psa\/ui\/(.*)$/, replacement: path.resolve(__dirname, '../ui/src/$1') },
      { find: /^@alga-psa\/scheduling$/, replacement: path.resolve(__dirname, '../scheduling/src/index.ts') },
      { find: /^@alga-psa\/scheduling\/(.*)$/, replacement: path.resolve(__dirname, '../scheduling/src/$1') },
      { find: /^@alga-psa\/reporting$/, replacement: path.resolve(__dirname, '../reporting/src/index.ts') },
      { find: /^@alga-psa\/reporting\/(.*)$/, replacement: path.resolve(__dirname, '../reporting/src/$1') },
      // The provider's deep feature imports (billing wizard/dialog/hour-blocks,
      // tickets quick-add, opportunities tab, surveys card) are subpaths the
      // packages' exports maps do not list; tsconfig paths resolve them for
      // tsc/Next, and these aliases do the same for vitest.
      { find: /^@alga-psa\/billing$/, replacement: path.resolve(__dirname, '../billing/src/index.ts') },
      { find: /^@alga-psa\/billing\/(.*)$/, replacement: path.resolve(__dirname, '../billing/src/$1') },
      { find: /^@alga-psa\/tickets$/, replacement: path.resolve(__dirname, '../tickets/src/index.ts') },
      { find: /^@alga-psa\/tickets\/(.*)$/, replacement: path.resolve(__dirname, '../tickets/src/$1') },
      { find: /^@alga-psa\/opportunities$/, replacement: path.resolve(__dirname, '../opportunities/src/index.ts') },
      { find: /^@alga-psa\/opportunities\/(.*)$/, replacement: path.resolve(__dirname, '../opportunities/src/$1') },
      { find: /^@alga-psa\/surveys$/, replacement: path.resolve(__dirname, '../surveys/src/index.ts') },
      { find: /^@alga-psa\/surveys\/(.*)$/, replacement: path.resolve(__dirname, '../surveys/src/$1') },
      { find: /^@alga-psa\/sla$/, replacement: path.resolve(__dirname, '../sla/src/index.ts') },
      { find: /^@alga-psa\/sla\/(.*)$/, replacement: path.resolve(__dirname, '../sla/src/$1') },
    ],
  },
});
