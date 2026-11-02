/**
 * Tenant-bound signed licence state (CM L8a). A tenant's own claim, kept apart from the
 * installation singleton `license_state`, which this migration and its readers never touch.
 *
 * CREATE only; zero foreign keys (cross-tenant FKs are not modelled; the owner is checked in
 * app code); distributed on `tenant`. Idempotent; safe to re-run.
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

const TABLE = 'tenant_license_state';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable().primary();
      table.text('license_token').notNullable();
      table.text('license_id').notNullable();
      table.integer('seats').nullable();
      table.timestamp('valid_until', { useTz: true }).notNullable();
      table.timestamp('verified_at', { useTz: true }).notNullable();
      table.timestamp('updated_at', { useTz: true }).notNullable();
      table.check('seats IS NULL OR seats >= 0');
    });
  }
  await ensureTenantDistribution(knex, TABLE);
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  if (await knex(TABLE).first()) throw new Error('Cannot remove tenant-bound license state');
  await knex.schema.dropTable(TABLE);
};

exports.config = { transaction: false };
