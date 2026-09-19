exports.up = function(knex) {
  return knex.schema
    .alterTable('project_tasks', function(table) {
      table.uuid('project_status_mapping_id').references('project_status_mapping_id').inTable('project_status_mappings');
    });
};

exports.down = function(knex) {
  return knex.schema
    .alterTable('project_tasks', function(table) {
      table.dropColumn('project_status_mapping_id');
    });
};
