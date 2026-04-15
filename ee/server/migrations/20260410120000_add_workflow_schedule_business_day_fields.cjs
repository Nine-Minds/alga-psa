/**
 * EE-only migration for workflow recurring business-day scheduling metadata.
 *
 * Adds:
 * - day_type_filter (any|business|non_business)
 * - business_hours_schedule_id (optional override)
 */

exports.config = { transaction: false };

const TABLE = 'tenant_workflow_schedule';
const DAY_TYPE_CHECK = 'tenant_workflow_schedule_day_type_filter_check';
const DAY_TYPE_INDEX = 'tenant_workflow_schedule_tenant_day_type_filter_idx';
const BUSINESS_HOURS_INDEX = 'tenant_workflow_schedule_tenant_business_hours_schedule_idx';

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable(TABLE);
  if (!hasTable) return;

  const hasDayTypeFilter = await knex.schema.hasColumn(TABLE, 'day_type_filter');
  const hasBusinessHoursScheduleId = await knex.schema.hasColumn(TABLE, 'business_hours_schedule_id');

  await knex.schema.alterTable(TABLE, (table) => {
    if (!hasDayTypeFilter) {
      table.text('day_type_filter').notNullable().defaultTo('any');
    }
    if (!hasBusinessHoursScheduleId) {
      table.uuid('business_hours_schedule_id').nullable();
    }
  });

  await knex.raw(`
    UPDATE ${TABLE}
    SET day_type_filter = 'any'
    WHERE day_type_filter IS NULL
  `);

  await knex.raw(`
    ALTER TABLE ${TABLE}
    DROP CONSTRAINT IF EXISTS ${DAY_TYPE_CHECK}
  `);

  await knex.raw(`
    ALTER TABLE ${TABLE}
    ADD CONSTRAINT ${DAY_TYPE_CHECK}
    CHECK (day_type_filter IN ('any', 'business', 'non_business'))
  `);

  await knex.schema.alterTable(TABLE, (table) => {
    table.index(['tenant_id', 'day_type_filter'], DAY_TYPE_INDEX);
    table.index(['tenant_id', 'business_hours_schedule_id'], BUSINESS_HOURS_INDEX);
  });
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable(TABLE);
  if (!hasTable) return;

  const hasDayTypeFilter = await knex.schema.hasColumn(TABLE, 'day_type_filter');
  const hasBusinessHoursScheduleId = await knex.schema.hasColumn(TABLE, 'business_hours_schedule_id');

  await knex.raw(`DROP INDEX IF EXISTS ${DAY_TYPE_INDEX}`);
  await knex.raw(`DROP INDEX IF EXISTS ${BUSINESS_HOURS_INDEX}`);

  await knex.raw(`
    ALTER TABLE ${TABLE}
    DROP CONSTRAINT IF EXISTS ${DAY_TYPE_CHECK}
  `);

  await knex.schema.alterTable(TABLE, (table) => {
    if (hasBusinessHoursScheduleId) {
      table.dropColumn('business_hours_schedule_id');
    }
    if (hasDayTypeFilter) {
      table.dropColumn('day_type_filter');
    }
  });
};
