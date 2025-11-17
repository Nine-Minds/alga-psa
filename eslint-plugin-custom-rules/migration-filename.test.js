import { RuleTester } from 'eslint';
import migrationFilename from './migration-filename.js';

const ruleTester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'commonjs',
  },
});

ruleTester.run('migration-filename', migrationFilename, {
  valid: [
    {
      // Valid migration file with proper yyyymmddhhmm format (after cutoff)
      code: 'exports.up = function(knex) {};',
      filename: '/app/server/migrations/202511011430_add_users_table.cjs',
    },
    {
      // Old migration before cutoff date (20251101) - grandfathered in even with wrong format
      code: 'exports.up = function(knex) {};',
      filename: '/app/server/migrations/20241002132600_add_tax_rates_tables.cjs',
    },
    {
      // Old migration from 2024 - grandfathered in
      code: 'exports.up = function(knex) {};',
      filename: '/app/server/migrations/202409071803_initial_schema.cjs',
    },
    {
      // Migration exactly on cutoff date with correct format
      code: 'exports.up = function(knex) {};',
      filename: '/app/server/migrations/202511010000_cutoff_date.cjs',
    },
    {
      // Valid migration file with 14-digit format (yyyymmddhhmmss)
      code: 'exports.up = function(knex) {};',
      filename: '/app/server/migrations/20251102090000_create_import_framework_tables.cjs',
    },
    {
      // Valid migration file with 14-digit format and seconds
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
      // Invalid format - 10 digits instead of 12/14 (after cutoff)
      code: 'exports.up = function(knex) {};',
      filename: '/app/server/migrations/2025110116_wrong_format.cjs',
      errors: [
        {
          messageId: 'invalidFormat',
        },
      ],
    },
    {
      // Missing underscore separator (after cutoff)
      code: 'exports.up = function(knex) {};',
      filename: '/app/server/migrations/202511011430add_users.cjs',
      errors: [
        {
          messageId: 'invalidFormat',
        },
      ],
    },
    {
      // Invalid timestamp - month 13 (after cutoff)
      code: 'exports.up = function(knex) {};',
      filename: '/app/server/migrations/202513311430_invalid_month.cjs',
      errors: [
        {
          messageId: 'invalidTimestamp',
        },
      ],
    },
    {
      // Invalid timestamp - day 32 (after cutoff)
      code: 'exports.up = function(knex) {};',
      filename: '/app/server/migrations/202511321430_invalid_day.cjs',
      errors: [
        {
          messageId: 'invalidTimestamp',
        },
      ],
    },
    {
      // Invalid timestamp - hour 25 (after cutoff)
      code: 'exports.up = function(knex) {};',
      filename: '/app/server/migrations/202511012530_invalid_hour.cjs',
      errors: [
        {
          messageId: 'invalidTimestamp',
        },
      ],
    },
    {
      // Invalid timestamp - minute 60 (after cutoff)
      code: 'exports.up = function(knex) {};',
      filename: '/app/server/migrations/202511011460_invalid_minute.cjs',
      errors: [
        {
          messageId: 'invalidTimestamp',
        },
      ],
    },
  ],
});

console.log('All tests passed!');
