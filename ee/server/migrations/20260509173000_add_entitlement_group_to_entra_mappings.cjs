/**
 * Migration: add client portal entitlement group id to Entra client mappings.
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
    'client_portal_entitlement_group_id',
    (table) => {
      table.text('client_portal_entitlement_group_id').nullable();
    }
  );
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasColumn(
    'entra_client_tenant_mappings',
    'client_portal_entitlement_group_id'
  );
  if (exists) {
    await knex.schema.alterTable('entra_client_tenant_mappings', (table) => {
      table.dropColumn('client_portal_entitlement_group_id');
    });
  }
};

