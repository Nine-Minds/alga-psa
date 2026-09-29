export default {
  $schema: './node_modules/@stryker-mutator/core/schema/stryker-schema.json',
  testRunner: 'vitest',
  vitest: { configFile: 'tools/mutation/vitest.config.ts', related: true },
  mutate: [
    'shared/billingClients/calendarMonthEndClosePolicy.ts',
    'packages/authorization/src/kernel/scope.ts',
  ],
  // Keep the sandbox small and explicit; node_modules is supplied by Stryker.
  ignorePatterns: [
    '**',
    '!package.json', '!package-lock.json', '!stryker.config.mjs',
    '!tools/mutation/vitest.config.ts',
    '!shared/billingClients/calendarMonthEndClosePolicy.ts',
    '!packages/authorization/src/kernel/**/*.ts',
    '!server/src/test/unit/billing/calendarMonthEndClosePolicy.test.ts',
    '!server/src/test/unit/authorization/kernel.failClosed.test.ts',
  ],
  concurrency: 2,
  timeoutMS: 10000,
  dryRunTimeoutMinutes: 2,
  reporters: ['clear-text', 'json', 'html'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  // Establish and review the scoped baseline before proposing a score ratchet.
  thresholds: { high: 90, low: 70, break: 0 },
  cleanTempDir: true,
};
