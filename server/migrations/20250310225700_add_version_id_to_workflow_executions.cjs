/**
 * Migration to add version_id column to workflow_executions table
 * This allows linking workflow executions directly to their workflow registration versions
 */
exports.up = async function(knex) {
  // First add the version_id column without constraints
  await knex.schema.alterTable('workflow_executions', (table) => {
    // Add the version_id column (nullable initially to allow for existing records)
    table.uuid('version_id');
  });

  // Fill in existing values by matching on workflow_name and workflow_version
  await knex.raw(`
    UPDATE workflow_executions we
    SET version_id = wrv.version_id
    FROM workflow_registration_versions wrv
    JOIN workflow_registrations wr ON wrv.registration_id = wr.registration_id
    WHERE we.workflow_name = wr.name
    AND we.workflow_version = wrv.version
    AND we.tenant = wr.tenant_id
  `);

  // Now add the foreign key constraint and index
  await knex.schema.alterTable('workflow_executions', (table) => {
    // Add foreign key constraint
    table.foreign('version_id').references('version_id').inTable('workflow_registration_versions').onDelete('SET NULL');
    
    // Create an index for efficient querying
    table.index(['tenant', 'version_id'], 'idx_workflow_executions_tenant_version');
  });
};

exports.down = async function(knex) {
  // Remove the version_id column
  await knex.schema.alterTable('workflow_executions', (table) => {
    table.dropIndex(['tenant', 'version_id'], 'idx_workflow_executions_tenant_version');
    table.dropForeign('version_id');
    table.dropColumn('version_id');
  });
};