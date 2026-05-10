/**
 * Migration: add per-mapping client portal entitlement membership mode.
 */

const ensureColumn = async (knex, tableName, columnName, alterFn) => {
  const exists = await knex.schema.hasColumn(tableName, columnName);
  if (!exists) {
    await knex.schema.alterTable(tableName, alterFn);
  }
};

exports.up = async function up(knex) {
  await ensureColumn(
    knex,
    'entra_client_tenant_mappings',
    'client_portal_entitlement_membership_mode',
    (table) => {
      table
        .text('client_portal_entitlement_membership_mode')
        .notNullable()
        .defaultTo('transitive');
    }
  );
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasColumn(
    'entra_client_tenant_mappings',
    'client_portal_entitlement_membership_mode'
  );
  if (exists) {
    await knex.schema.alterTable('entra_client_tenant_mappings', (table) => {
      table.dropColumn('client_portal_entitlement_membership_mode');
    });
  }
};

