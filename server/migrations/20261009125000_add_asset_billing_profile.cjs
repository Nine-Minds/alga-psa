/**
 * Billing attribution for assets and RMM organizations (FR-F1).
 *
 * An alert ticket for a device fell to the client's default billing profile
 * because neither the device nor the RMM organization it came from could say
 * otherwise. Both now carry an optional profile, which the ticket-from-asset
 * paths resolve through (asset → location default → null).
 *
 * The value is cleared whenever the row's `client_id` changes — a profile
 * belongs to one client — which the write paths enforce.
 *
 * The foreign keys go through the Citus compatibility probe: a constraint
 * between a distributed and a coordinator-local table cannot be enforced, and
 * `rmm_organization_mappings` is not distributed everywhere
 * `client_billing_profiles` is. Same rule as 20260816010000 for the ticket and
 * project profile columns.
 */

const { ensureCompositeFk } = require('./utils/citusDistribution.cjs');

const PROFILE_FKS = [
  {
    table: 'assets',
    constraint: 'assets_tenant_billing_profile_id_foreign',
    columns: ['tenant', 'billing_profile_id'],
    referencedTable: 'client_billing_profiles',
    referencedColumns: ['tenant', 'billing_profile_id'],
  },
  {
    table: 'rmm_organization_mappings',
    constraint: 'rmm_organization_mappings_tenant_billing_profile_id_foreign',
    columns: ['tenant', 'billing_profile_id'],
    referencedTable: 'client_billing_profiles',
    referencedColumns: ['tenant', 'billing_profile_id'],
  },
];

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('assets', 'billing_profile_id'))) {
    await knex.schema.alterTable('assets', (table) => {
      table.uuid('billing_profile_id').nullable();
    });
  }
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_assets_billing_profile
    ON assets (tenant, billing_profile_id)
    WHERE billing_profile_id IS NOT NULL
  `);

  if (!(await knex.schema.hasColumn('rmm_organization_mappings', 'billing_profile_id'))) {
    await knex.schema.alterTable('rmm_organization_mappings', (table) => {
      table.uuid('billing_profile_id').nullable();
    });
  }

  for (const fk of PROFILE_FKS) {
    await ensureCompositeFk(knex, fk);
  }
};

exports.down = async function down(knex) {
  for (const { table, constraint } of PROFILE_FKS) {
    await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${constraint}`);
  }
  if (await knex.schema.hasColumn('assets', 'billing_profile_id')) {
    await knex.raw('DROP INDEX IF EXISTS idx_assets_billing_profile');
    await knex.schema.alterTable('assets', (table) => {
      table.dropColumn('billing_profile_id');
    });
  }
  if (await knex.schema.hasColumn('rmm_organization_mappings', 'billing_profile_id')) {
    await knex.schema.alterTable('rmm_organization_mappings', (table) => {
      table.dropColumn('billing_profile_id');
    });
  }
};
