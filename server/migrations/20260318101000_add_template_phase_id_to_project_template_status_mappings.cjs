exports.up = async function(knex) {
  await knex.schema.alterTable('project_template_status_mappings', function(table) {
    table.uuid('template_phase_id').nullable();
  });

  await knex.schema.alterTable('project_template_status_mappings', function(table) {
    table
      .foreign(['tenant', 'template_phase_id'])
      .references(['tenant', 'template_phase_id'])
      .inTable('project_template_phases')
      .onDelete('CASCADE');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('project_template_status_mappings', function(table) {
    table.dropForeign(['tenant', 'template_phase_id']);
  });

  await knex.schema.alterTable('project_template_status_mappings', function(table) {
    table.dropColumn('template_phase_id');
  });
};
