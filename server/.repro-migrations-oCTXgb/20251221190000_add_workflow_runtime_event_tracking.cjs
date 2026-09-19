exports.up = async function (knex) {
  await knex.schema.alterTable('workflow_runtime_events', (table) => {
    table.uuid('matched_run_id');
    table.uuid('matched_wait_id');
    table.text('matched_step_path');
    table.text('error_message');
    table.index(['created_at'], 'idx_workflow_runtime_events_created_at');
    table.index(['matched_run_id'], 'idx_workflow_runtime_events_matched_run');
  });

  await knex.schema.alterTable('workflow_runs', (table) => {
    table.index(['workflow_id', 'status', 'updated_at'], 'idx_workflow_runs_workflow_status_updated');
  });

  await knex.schema.alterTable('workflow_run_steps', (table) => {
    table.index(['run_id', 'step_id'], 'idx_workflow_run_steps_run_step');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('workflow_run_steps', (table) => {
    table.dropIndex(['run_id', 'step_id'], 'idx_workflow_run_steps_run_step');
  });

  await knex.schema.alterTable('workflow_runs', (table) => {
    table.dropIndex(['workflow_id', 'status', 'updated_at'], 'idx_workflow_runs_workflow_status_updated');
  });

  await knex.schema.alterTable('workflow_runtime_events', (table) => {
    table.dropIndex(['matched_run_id'], 'idx_workflow_runtime_events_matched_run');
    table.dropIndex(['created_at'], 'idx_workflow_runtime_events_created_at');
    table.dropColumn('error_message');
    table.dropColumn('matched_step_path');
    table.dropColumn('matched_wait_id');
    table.dropColumn('matched_run_id');
  });
};
