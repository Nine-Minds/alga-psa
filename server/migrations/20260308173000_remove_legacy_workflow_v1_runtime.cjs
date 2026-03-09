const LEGACY_INBOUND_EMAIL_WORKFLOW_ID = '00000000-0000-0000-0000-00000000e001';

const LEGACY_WORKFLOW_TABLES = [
  'system_workflow_event_attachments',
  'workflow_event_mappings',
  'workflow_event_attachments',
  'workflow_action_dependencies',
  'workflow_registration_versions',
  'system_workflow_registration_versions',
  'workflow_action_results',
  'workflow_sync_points',
  'workflow_timers',
  'workflow_event_processing',
  'workflow_events',
  'workflow_snapshots',
  'workflow_triggers',
  'workflow_executions',
  'workflow_registrations',
  'system_workflow_registrations',
  'workflow_templates',
  'workflow_template_categories',
];

exports.up = async function up(knex) {
  await knex('workflow_definition_versions')
    .where({ workflow_id: LEGACY_INBOUND_EMAIL_WORKFLOW_ID })
    .del()
    .catch(() => undefined);

  await knex('workflow_definitions')
    .where({ workflow_id: LEGACY_INBOUND_EMAIL_WORKFLOW_ID })
    .del()
    .catch(() => undefined);

  for (const tableName of LEGACY_WORKFLOW_TABLES) {
    await knex.raw(`DROP TABLE IF EXISTS "${tableName}" CASCADE;`);
  }
};

exports.down = async function down() {
  // Destructive cleanup for a retired subsystem. Recreating the legacy schema is intentionally unsupported.
};
