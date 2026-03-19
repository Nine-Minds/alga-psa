exports.up = async function(knex) {
  await knex.schema.alterTable('project_status_mappings', function(table) {
    table.uuid('phase_id').nullable();
    table.index(['tenant', 'project_id', 'phase_id']);
  });

  await knex.schema.alterTable('project_status_mappings', function(table) {
    table
      .foreign(['tenant', 'phase_id'])
      .references(['tenant', 'phase_id'])
      .inTable('project_phases')
      .onDelete('CASCADE');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('project_status_mappings', function(table) {
    table.dropForeign(['tenant', 'phase_id']);
  });

  await knex.schema.alterTable('project_status_mappings', function(table) {
    table.dropIndex(['tenant', 'project_id', 'phase_id']);
    table.dropColumn('phase_id');
  });
};

exports.config = { transaction: false };
