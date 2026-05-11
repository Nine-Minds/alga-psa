exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn(
    'entra_client_tenant_mappings',
    'client_portal_default_role_name'
  );

  if (!hasColumn) {
    await knex.schema.alterTable('entra_client_tenant_mappings', (table) => {
      table.text('client_portal_default_role_name').nullable();
    });
  }
};

exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn(
    'entra_client_tenant_mappings',
    'client_portal_default_role_name'
  );

  if (hasColumn) {
    await knex.schema.alterTable('entra_client_tenant_mappings', (table) => {
      table.dropColumn('client_portal_default_role_name');
    });
  }
};
