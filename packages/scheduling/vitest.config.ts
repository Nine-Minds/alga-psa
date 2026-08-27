import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    // The pre-existing tests/*.test.tsx files predate tsx inclusion here and
    // no longer collect/pass; they stay dormant until repaired, so only the
    // availability component regression is listed explicitly.
    include: [
      'tests/**/*.test.ts',
      'src/**/*.test.ts',
      'tests/AvailabilitySettings.component.test.tsx',
      'tests/SchedulePage.accessRetry.test.tsx',
    ],
    testTimeout: 10000,
  },
  resolve: {
    alias: [
      // Lets component tests vi.mock the same specifier the components import.
      { find: /^@alga-psa\/scheduling\/actions$/, replacement: path.resolve(__dirname, 'src/actions/index.ts') },
      // Must precede the @alga-psa/auth alias, whose regex would otherwise
      // swallow "@alga-psa/authorization/..." specifiers.
      { find: /^@alga-psa\/authorization(.*)$/, replacement: path.resolve(__dirname, '../authorization/src$1') },
      { find: /^@alga-psa\/auth(.*)$/, replacement: path.resolve(__dirname, '../auth/src$1') },
      { find: /^@alga-psa\/core$/, replacement: path.resolve(__dirname, '../core/src/index.ts') },
      { find: /^@alga-psa\/core\/(.*)$/, replacement: path.resolve(__dirname, '../core/src/lib/$1') },
      { find: /^@alga-psa\/db(.*)$/, replacement: path.resolve(__dirname, '../db/src$1') },
      { find: /^@alga-psa\/types(.*)$/, replacement: path.resolve(__dirname, '../types/src$1') },
      { find: /^@alga-psa\/ui(.*)$/, replacement: path.resolve(__dirname, '../ui/src$1') },
      { find: /^@alga-psa\/validation(.*)$/, replacement: path.resolve(__dirname, '../validation/src$1') },
      { find: /^@alga-psa\/event-bus(.*)$/, replacement: path.resolve(__dirname, '../event-bus/src$1') },
      { find: /^@alga-psa\/event-schemas(.*)$/, replacement: path.resolve(__dirname, '../event-schemas/src$1') },
      // Resolve @alga-psa/shared from source like every other workspace dep above;
      // without this the specifier falls through to the package's exports map, which
      // points at shared/dist/*.js — absent in CI (the unit-test job never builds it),
      // so the suite errored "Cannot find package '@alga-psa/shared/...'". Matches the
      // alias billing/tickets/integrations already use.
      { find: /^@alga-psa\/shared$/, replacement: path.resolve(__dirname, '../../shared') },
      { find: /^@alga-psa\/shared\/(.*)$/, replacement: path.resolve(__dirname, '../../shared/$1') },
      { find: /^@alga-psa\/workflow-streams$/, replacement: path.resolve(__dirname, '../workflow-streams/src/streams/index.ts') },
      { find: /^@alga-psa\/workflow-streams\/(.*)$/, replacement: path.resolve(__dirname, '../workflow-streams/src/streams/$1') },
      { find: /^@alga-psa\/workflows(.*)$/, replacement: path.resolve(__dirname, '../../ee/packages/workflows/src$1') },
    ],
  },
});
