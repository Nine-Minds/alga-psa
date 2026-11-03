/**
 * Co-managed IT L7b2: dedicated portable-restore suspension (new table only).
 *
 * A row marks a tenant that is mid-restore or restored-but-not-activated. It is
 * deliberately NOT a value of tenants.suspended_at / tenants_suspended_reason_check:
 * the shared tenants table is untouched. No foreign keys (the tenant row may not
 * exist yet), no triggers, no backfill. Idempotent.
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

const TABLE = 'portable_restore_suspensions';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.text('reason').notNullable().defaultTo('portable_restore_pending_activation');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('released_at', { useTz: true }).nullable();
      table.primary(['tenant']);
      table.check("reason IN ('portable_restore_in_progress', 'portable_restore_pending_activation')");
    });
  }
  await ensureTenantDistribution(knex, TABLE);
};

exports.down = async function down(knex) {
  if ((await knex.schema.hasTable(TABLE)) && (await knex(TABLE).first())) {
    throw new Error('Cannot remove portable restore suspensions that still exist');
  }
  await knex.schema.dropTableIfExists(TABLE);
};

exports.config = { transaction: false };
