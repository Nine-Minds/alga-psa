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
 */

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('assets', 'billing_profile_id'))) {
    await knex.schema.alterTable('assets', (table) => {
      table.uuid('billing_profile_id').nullable();
      table
        .foreign(['tenant', 'billing_profile_id'])
        .references(['tenant', 'billing_profile_id'])
        .inTable('client_billing_profiles');
    });
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_assets_billing_profile
      ON assets (tenant, billing_profile_id)
      WHERE billing_profile_id IS NOT NULL
    `);
  }

  if (!(await knex.schema.hasColumn('rmm_organization_mappings', 'billing_profile_id'))) {
    await knex.schema.alterTable('rmm_organization_mappings', (table) => {
      table.uuid('billing_profile_id').nullable();
      table
        .foreign(['tenant', 'billing_profile_id'])
        .references(['tenant', 'billing_profile_id'])
        .inTable('client_billing_profiles');
    });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('assets', 'billing_profile_id')) {
    await knex.raw('DROP INDEX IF EXISTS idx_assets_billing_profile');
    await knex.schema.alterTable('assets', (table) => {
      table.dropForeign(['tenant', 'billing_profile_id']);
      table.dropColumn('billing_profile_id');
    });
  }
  if (await knex.schema.hasColumn('rmm_organization_mappings', 'billing_profile_id')) {
    await knex.schema.alterTable('rmm_organization_mappings', (table) => {
      table.dropForeign(['tenant', 'billing_profile_id']);
      table.dropColumn('billing_profile_id');
    });
  }
};
