exports.up = async function up(knex) {
  const hasTarget = await knex.schema.hasColumn('entra_client_tenant_mappings', 'client_portal_workflow_target');
  if (!hasTarget) {
    await knex.schema.alterTable('entra_client_tenant_mappings', (table) => {
      table.text('client_portal_workflow_target').nullable();
    });
  }

  const hasConfig = await knex.schema.hasColumn('entra_client_tenant_mappings', 'client_portal_workflow_config');
  if (!hasConfig) {
    await knex.schema.alterTable('entra_client_tenant_mappings', (table) => {
      table.jsonb('client_portal_workflow_config').nullable();
    });
  }
};

exports.down = async function down(knex) {
  const hasConfig = await knex.schema.hasColumn('entra_client_tenant_mappings', 'client_portal_workflow_config');
  if (hasConfig) {
    await knex.schema.alterTable('entra_client_tenant_mappings', (table) => {
      table.dropColumn('client_portal_workflow_config');
    });
  }

  const hasTarget = await knex.schema.hasColumn('entra_client_tenant_mappings', 'client_portal_workflow_target');
  if (hasTarget) {
    await knex.schema.alterTable('entra_client_tenant_mappings', (table) => {
      table.dropColumn('client_portal_workflow_target');
    });
  }
};
