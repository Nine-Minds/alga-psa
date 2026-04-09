'use strict';

exports.up = async function (knex) {
  await knex.schema.alterTable('workflow_runs', (table) => {
    table.text('engine').nullable();
    table.text('temporal_workflow_id').nullable();
    table.text('temporal_run_id').nullable();
    table.text('definition_hash').nullable();
    table.text('runtime_semantics_version').nullable();
    table.uuid('parent_run_id').nullable();
    table.uuid('root_run_id').nullable();

    table.index(['engine', 'status'], 'idx_workflow_runs_engine_status');
    table.index(['temporal_workflow_id'], 'idx_workflow_runs_temporal_workflow_id');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('workflow_runs', (table) => {
    table.dropIndex(['temporal_workflow_id'], 'idx_workflow_runs_temporal_workflow_id');
    table.dropIndex(['engine', 'status'], 'idx_workflow_runs_engine_status');

    table.dropColumn('root_run_id');
    table.dropColumn('parent_run_id');
    table.dropColumn('runtime_semantics_version');
    table.dropColumn('definition_hash');
    table.dropColumn('temporal_run_id');
    table.dropColumn('temporal_workflow_id');
    table.dropColumn('engine');
  });
};
