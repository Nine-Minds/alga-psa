/**
 * Add client_portal_config JSONB column to projects and project_templates tables
 */
exports.config = { transaction: false };

const DEFAULT_CLIENT_PORTAL_CONFIG = {
  show_phases: false,
  show_phase_completion: false,
  show_tasks: false,
  show_task_services: false,
  allow_document_uploads: false,
  visible_task_fields: ['task_name', 'due_date', 'status']
};

exports.up = async function(knex) {
  console.log('Adding client_portal_config column to projects and project_templates...');

  // Add to projects table
  await knex.schema.alterTable('projects', (table) => {
    table.jsonb('client_portal_config').defaultTo(JSON.stringify(DEFAULT_CLIENT_PORTAL_CONFIG));
  });
  console.log('  ✓ Added client_portal_config to projects table');

  // Add to project_templates table
  await knex.schema.alterTable('project_templates', (table) => {
    table.jsonb('client_portal_config').defaultTo(JSON.stringify(DEFAULT_CLIENT_PORTAL_CONFIG));
  });
  console.log('  ✓ Added client_portal_config to project_templates table');

  console.log('Client portal config columns added successfully');
};

exports.down = async function(knex) {
  console.log('Dropping client_portal_config columns...');

  await knex.schema.alterTable('projects', (table) => {
    table.dropColumn('client_portal_config');
  });
  console.log('  ✓ Dropped client_portal_config from projects table');

  await knex.schema.alterTable('project_templates', (table) => {
    table.dropColumn('client_portal_config');
  });
  console.log('  ✓ Dropped client_portal_config from project_templates table');

  console.log('Client portal config columns dropped successfully');
};
