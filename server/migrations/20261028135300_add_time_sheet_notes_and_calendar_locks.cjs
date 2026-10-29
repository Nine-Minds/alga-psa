// CM L6a1: nullable time_sheets.notes, and the per-tenant lock row table used
// to serialize time-period calendar materialization. Zero foreign keys; the
// table is created empty and distributed immediately. Idempotent.
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

exports.config = { transaction: false };

exports.up = async function up(knex) {
  if ((await knex.schema.hasTable('time_sheets')) && !(await knex.schema.hasColumn('time_sheets', 'notes'))) {
    await knex.schema.alterTable('time_sheets', (table) => table.text('notes').nullable());
  }
  if (!(await knex.schema.hasTable('time_period_calendar_locks'))) {
    await knex.schema.createTable('time_period_calendar_locks', (table) => table.uuid('tenant').primary());
  }
  await ensureTenantDistribution(knex, 'time_period_calendar_locks');
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('time_period_calendar_locks');
  if (await knex.schema.hasColumn('time_sheets', 'notes')) {
    if (await knex('time_sheets').whereNotNull('notes').first('id')) {
      throw new Error('Cannot discard retained timesheet notes; export or reconcile them before rollback');
    }
    await knex.schema.alterTable('time_sheets', (table) => table.dropColumn('notes'));
  }
};
