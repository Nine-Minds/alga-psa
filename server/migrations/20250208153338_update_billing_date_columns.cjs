/**
 * Update billing-related date columns to use appropriate date types
 * Business date fields should use date type
 * Audit/timestamp fields remain as timestamptz
 */
exports.up = function(knex) {
  return knex.schema
    .alterTable('company_billing_plans', function(table) {
      // First create new columns
      knex.raw('ALTER TABLE company_billing_plans ADD COLUMN start_date_new date');
      knex.raw('ALTER TABLE company_billing_plans ADD COLUMN end_date_new date');

      // Convert data
      knex.raw(`
        UPDATE company_billing_plans 
        SET start_date_new = start_date::date,
            end_date_new = end_date::date
      `);

      // Drop old columns and rename new ones
      knex.raw('ALTER TABLE company_billing_plans DROP COLUMN start_date');
      knex.raw('ALTER TABLE company_billing_plans DROP COLUMN end_date');
      knex.raw('ALTER TABLE company_billing_plans RENAME COLUMN start_date_new TO start_date');
      knex.raw('ALTER TABLE company_billing_plans RENAME COLUMN end_date_new TO end_date');

      // Add NOT NULL constraint back to start_date
      knex.raw('ALTER TABLE company_billing_plans ALTER COLUMN start_date SET NOT NULL');
    })
    .alterTable('discounts', function(table) {
      // First create new columns
      knex.raw('ALTER TABLE discounts ADD COLUMN start_date_new date');
      knex.raw('ALTER TABLE discounts ADD COLUMN end_date_new date');

      // Convert data
      knex.raw(`
        UPDATE discounts 
        SET start_date_new = start_date::date,
            end_date_new = end_date::date
      `);

      // Drop old columns and rename new ones
      knex.raw('ALTER TABLE discounts DROP COLUMN start_date');
      knex.raw('ALTER TABLE discounts DROP COLUMN end_date');
      knex.raw('ALTER TABLE discounts RENAME COLUMN start_date_new TO start_date');
      knex.raw('ALTER TABLE discounts RENAME COLUMN end_date_new TO end_date');

      // Add NOT NULL constraint back to start_date
      knex.raw('ALTER TABLE discounts ALTER COLUMN start_date SET NOT NULL');
    })
    .alterTable('bucket_usage', function(table) {
      // First create new columns
      knex.raw('ALTER TABLE bucket_usage ADD COLUMN period_start_new date');
      knex.raw('ALTER TABLE bucket_usage ADD COLUMN period_end_new date');

      // Convert data
      knex.raw(`
        UPDATE bucket_usage 
        SET period_start_new = period_start::date,
            period_end_new = period_end::date
      `);

      // Drop old columns and rename new ones
      knex.raw('ALTER TABLE bucket_usage DROP COLUMN period_start');
      knex.raw('ALTER TABLE bucket_usage DROP COLUMN period_end');
      knex.raw('ALTER TABLE bucket_usage RENAME COLUMN period_start_new TO period_start');
      knex.raw('ALTER TABLE bucket_usage RENAME COLUMN period_end_new TO period_end');

      // Add NOT NULL constraints back
      knex.raw('ALTER TABLE bucket_usage ALTER COLUMN period_start SET NOT NULL');
      knex.raw('ALTER TABLE bucket_usage ALTER COLUMN period_end SET NOT NULL');
    })
    .alterTable('usage_tracking', function(table) {
      // First create new column
      knex.raw('ALTER TABLE usage_tracking ADD COLUMN usage_date_new date');

      // Convert data
      knex.raw(`
        UPDATE usage_tracking 
        SET usage_date_new = usage_date::date
      `);

      // Drop old column and rename new one
      knex.raw('ALTER TABLE usage_tracking DROP COLUMN usage_date');
      knex.raw('ALTER TABLE usage_tracking RENAME COLUMN usage_date_new TO usage_date');

      // Add NOT NULL constraint back
      knex.raw('ALTER TABLE usage_tracking ALTER COLUMN usage_date SET NOT NULL');
    });
};

exports.down = function(knex) {
  return knex.schema
    .alterTable('company_billing_plans', function(table) {
      // First create new columns
      knex.raw('ALTER TABLE company_billing_plans ADD COLUMN start_date_old timestamp with time zone');
      knex.raw('ALTER TABLE company_billing_plans ADD COLUMN end_date_old timestamp with time zone');

      // Convert data
      knex.raw(`
        UPDATE company_billing_plans 
        SET start_date_old = start_date::timestamp with time zone,
            end_date_old = end_date::timestamp with time zone
      `);

      // Drop old columns and rename new ones
      knex.raw('ALTER TABLE company_billing_plans DROP COLUMN start_date');
      knex.raw('ALTER TABLE company_billing_plans DROP COLUMN end_date');
      knex.raw('ALTER TABLE company_billing_plans RENAME COLUMN start_date_old TO start_date');
      knex.raw('ALTER TABLE company_billing_plans RENAME COLUMN end_date_old TO end_date');

      // Add NOT NULL constraint back to start_date
      knex.raw('ALTER TABLE company_billing_plans ALTER COLUMN start_date SET NOT NULL');
    })
    .alterTable('discounts', function(table) {
      // First create new columns
      knex.raw('ALTER TABLE discounts ADD COLUMN start_date_old timestamp with time zone');
      knex.raw('ALTER TABLE discounts ADD COLUMN end_date_old timestamp with time zone');

      // Convert data
      knex.raw(`
        UPDATE discounts 
        SET start_date_old = start_date::timestamp with time zone,
            end_date_old = end_date::timestamp with time zone
      `);

      // Drop old columns and rename new ones
      knex.raw('ALTER TABLE discounts DROP COLUMN start_date');
      knex.raw('ALTER TABLE discounts DROP COLUMN end_date');
      knex.raw('ALTER TABLE discounts RENAME COLUMN start_date_old TO start_date');
      knex.raw('ALTER TABLE discounts RENAME COLUMN end_date_old TO end_date');

      // Add NOT NULL constraint back to start_date
      knex.raw('ALTER TABLE discounts ALTER COLUMN start_date SET NOT NULL');
    })
    .alterTable('bucket_usage', function(table) {
      // First create new columns
      knex.raw('ALTER TABLE bucket_usage ADD COLUMN period_start_old timestamp with time zone');
      knex.raw('ALTER TABLE bucket_usage ADD COLUMN period_end_old timestamp with time zone');

      // Convert data
      knex.raw(`
        UPDATE bucket_usage 
        SET period_start_old = period_start::timestamp with time zone,
            period_end_old = period_end::timestamp with time zone
      `);

      // Drop old columns and rename new ones
      knex.raw('ALTER TABLE bucket_usage DROP COLUMN period_start');
      knex.raw('ALTER TABLE bucket_usage DROP COLUMN period_end');
      knex.raw('ALTER TABLE bucket_usage RENAME COLUMN period_start_old TO period_start');
      knex.raw('ALTER TABLE bucket_usage RENAME COLUMN period_end_old TO period_end');

      // Add NOT NULL constraints back
      knex.raw('ALTER TABLE bucket_usage ALTER COLUMN period_start SET NOT NULL');
      knex.raw('ALTER TABLE bucket_usage ALTER COLUMN period_end SET NOT NULL');
    })
    .alterTable('usage_tracking', function(table) {
      // First create new column
      knex.raw('ALTER TABLE usage_tracking ADD COLUMN usage_date_old timestamp with time zone');

      // Convert data
      knex.raw(`
        UPDATE usage_tracking 
        SET usage_date_old = usage_date::timestamp with time zone
      `);

      // Drop old column and rename new one
      knex.raw('ALTER TABLE usage_tracking DROP COLUMN usage_date');
      knex.raw('ALTER TABLE usage_tracking RENAME COLUMN usage_date_old TO usage_date');

      // Add NOT NULL constraint back
      knex.raw('ALTER TABLE usage_tracking ALTER COLUMN usage_date SET NOT NULL');
    });
};
