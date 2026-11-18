import baseConfig from './vitest.workspace-db.config';

// The workspace DB lane under a non-UTC server clock. Node caches the zone when a
// process starts, so it has to be set before vitest forks its workers: this config
// is evaluated in the parent process, and workers inherit its environment. Use it
// for suites whose behaviour must not depend on the host zone (date-only handling,
// business-date readiness), e.g. prepaidBlockDeployFixes.db.test.ts:
//   HOUR_BLOCK_DB_TESTS=1 ... npx vitest run -c vitest.workspace-db-newyork.config.ts ../packages/billing/tests/<file>
process.env.TZ = 'America/New_York';

export default baseConfig;
