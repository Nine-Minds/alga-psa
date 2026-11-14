import { RuleTester } from 'eslint';
import { describe, it } from 'node:test';
import migrationFilename from './migration-filename.js';

RuleTester.describe = describe;
RuleTester.it = it;

// Migration names use the author's wall clock (the rule parses them as local time).
// A name stamped a few hours ahead of the commit passes the author's lint run later
// that day but fails CI run sooner — so pin the boundary at hours, not years.
function localMigrationTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}
const HOUR_MS = 60 * 60 * 1000;
const anHourAgo = localMigrationTimestamp(new Date(Date.now() - HOUR_MS));
const inFourHours = localMigrationTimestamp(new Date(Date.now() + 4 * HOUR_MS));

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'commonjs',
  },
});

ruleTester.run('migration-filename', migrationFilename, {
  valid: [
    {
      // Timestamp earlier than now (hours, not days) is accepted
      code: 'exports.up = function(knex) {};',
      filename: `/app/server/migrations/${anHourAgo}_recent_migration.cjs`,
    },
    {
      // Old migration before cutoff date (20251118) - grandfathered in even with wrong format
      code: 'exports.up = function(knex) {};',
      filename: '/app/server/migrations/20241002132600_add_tax_rates_tables.cjs',
    },
    {
      // Old migration from 2024 - grandfathered in
      code: 'exports.up = function(knex) {};',
      filename: '/app/server/migrations/202409071803_initial_schema.cjs',
    },
    {
      // Migration from November 17, 2025 - grandfathered in
      code: 'exports.up = function(knex) {};',
      filename: '/app/server/migrations/20251117191500_add_dns_lookup_results_to_email_domains.cjs',
    },
    {
      // Migration from November 2, 2025 with 14-digit format - grandfathered in
      code: 'exports.up = function(knex) {};',
      filename: '/app/server/migrations/20251102090000_create_import_framework_tables.cjs',
    },
    {
      // Migration from November 4, 2025 with 14-digit format - grandfathered in
      code: 'exports.up = function(knex) {};',
      filename: '/app/server/migrations/20251104112815_add_hourly_fields_to_contract_lines.cjs',
    },
    {
      // File not in migrations directory should be ignored
      code: 'console.log("test");',
      filename: '/app/server/lib/202599991231_not_a_migration.cjs',
    },
    {
      // Non-.cjs file in migrations directory should be ignored
      code: 'console.log("test");',
      filename: '/app/server/migrations/README.md',
    },
  ],

  invalid: [
    {
      // Timestamp only hours ahead of now is still in the future and is rejected
      code: 'exports.up = function(knex) {};',
      filename: `/app/server/migrations/${inFourHours}_stamped_ahead_of_commit.cjs`,
      errors: [
        {
          messageId: 'futureTimestamp',
        },
      ],
    },
    {
      // Future timestamp - December 31, 2099 (after cutoff date)
      code: 'exports.up = function(knex) {};',
      filename: '/app/server/migrations/209912312359_future_migration.cjs',
      errors: [
        {
          messageId: 'futureTimestamp',
        },
      ],
    },
    {
      // Invalid format - 10 digits instead of 12/14 (after cutoff, but before grandfathering makes it moot, we use future date)
      code: 'exports.up = function(knex) {};',
      filename: '/app/server/migrations/2099112016_wrong_format.cjs',
      errors: [
        {
          messageId: 'invalidFormat',
        },
      ],
    },
    {
      // Missing underscore separator (after cutoff, use far future to avoid timestamp validation)
      code: 'exports.up = function(knex) {};',
      filename: '/app/server/migrations/209911201430add_users.cjs',
      errors: [
        {
          messageId: 'invalidFormat',
        },
      ],
    },
    {
      // Invalid timestamp - month 13 (after cutoff)
      code: 'exports.up = function(knex) {};',
      filename: '/app/server/migrations/209913201430_invalid_month.cjs',
      errors: [
        {
          messageId: 'invalidTimestamp',
        },
      ],
    },
    {
      // Invalid timestamp - day 32 (after cutoff)
      code: 'exports.up = function(knex) {};',
      filename: '/app/server/migrations/209911321430_invalid_day.cjs',
      errors: [
        {
          messageId: 'invalidTimestamp',
        },
      ],
    },
    {
      // Invalid timestamp - hour 25 (after cutoff)
      code: 'exports.up = function(knex) {};',
      filename: '/app/server/migrations/209911202530_invalid_hour.cjs',
      errors: [
        {
          messageId: 'invalidTimestamp',
        },
      ],
    },
    {
      // Invalid timestamp - minute 60 (after cutoff)
      code: 'exports.up = function(knex) {};',
      filename: '/app/server/migrations/209911201460_invalid_minute.cjs',
      errors: [
        {
          messageId: 'invalidTimestamp',
        },
      ],
    },
  ],
});
