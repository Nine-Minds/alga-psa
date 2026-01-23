'use strict';

exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('workflow_runs', 'event_type');
  if (!hasColumn) {
    await knex.schema.alterTable('workflow_runs', (table) => {
      table.text('event_type');
      table.index(['event_type'], 'idx_workflow_runs_event_type');
    });
  }
};

exports.down = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('workflow_runs', 'event_type');
  if (hasColumn) {
    await knex.schema.alterTable('workflow_runs', (table) => {
      table.dropIndex(['event_type'], 'idx_workflow_runs_event_type');
      table.dropColumn('event_type');
    });
  }
};
