import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

// Run the maintained behavioral suites against their real policy modules.
// No application bootstrap, database substitute, or mocked policy is involved.
export default defineConfig({
  root,
  resolve: { alias: {
    '@alga-psa/authorization/kernel': `${root}packages/authorization/src/kernel/index.ts`,
    '@alga-psa/shared/billingClients/calendarMonthEndClosePolicy': `${root}shared/billingClients/calendarMonthEndClosePolicy.ts`,
  } },
  test: {
    environment: 'node',
    include: [
      'server/src/test/unit/billing/calendarMonthEndClosePolicy.test.ts',
      'server/src/test/unit/authorization/kernel.failClosed.test.ts',
    ],
    passWithNoTests: false,
    testTimeout: 10000,
    coverage: { enabled: false },
  },
});
