
exports.up = function(knex) {
  return knex.schema.table('workflow_task_definitions', function(table) {
    table.text('form_type').defaultTo('tenant');
  })
  .then(() => {
    return knex('workflow_task_definitions')
      .whereIn('task_definition_id', ['workflow_execution_error', 'internal_workflow_error', 'secret_fetch_error'])
      .orWhere('task_definition_id', 'like', 'qbo_%')
      .update({ form_type: 'system' });
  });
};

exports.down = function(knex) {
  return knex.schema.table('workflow_task_definitions', function(table) {
    table.dropColumn('form_type');
  });
};
