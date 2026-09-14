'use strict';

/**
 * Tenant-level default tax rate.
 *
 * `tax_rates` gains `is_default` so an operator can designate which rate an
 * unspecified tax lookup should use. Before this column the fallback silently
 * chose the earliest-created active rate — an arbitrary choice the user could
 * not influence.
 *
 * At most one default per tenant is enforced by a partial unique index on
 * `(tenant) WHERE is_default = true`. `tenant` is the Citus distribution
 * column, and a distributed unique index must include the distribution column,
 * so the index is Citus-safe. The predicate limits it to a single row per
 * tenant, so the distribution column alone is sufficient.
 *
 * No default is pre-selected: the column defaults to false for every existing
 * row, leaving the choice to the operator. Unspecified lookups keep the legacy
 * earliest-active-rate fallback until a default is chosen, so existing tenants
 * are unaffected by the migration.
 *
 * Runs untransacted: each statement is idempotent (guarded ADD COLUMN and
 * IF NOT EXISTS index), so a partial run can be repeated safely.
 */

const TABLE = 'tax_rates';
const INDEX = 'tax_rates_tenant_default_unique';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn(TABLE, 'is_default'))) {
    await knex.schema.alterTable(TABLE, (table) => {
      table.boolean('is_default').notNullable().defaultTo(false);
    });
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX}
    ON ${TABLE} (tenant)
    WHERE is_default = true
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS ${INDEX}`);
  if (await knex.schema.hasColumn(TABLE, 'is_default')) {
    await knex.schema.alterTable(TABLE, (table) => {
      table.dropColumn('is_default');
    });
  }
};

exports.config = { transaction: false };
