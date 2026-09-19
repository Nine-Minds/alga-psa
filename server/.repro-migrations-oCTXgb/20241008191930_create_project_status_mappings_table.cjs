exports.up = function(knex) {
    knex.schema.alterTable("projects", function(table) {
        table.uuid('project_id').primary().unique().defaultTo(knex.raw('gen_random_uuid()'));
    });

    return knex.schema.createTable('project_status_mappings', function(table) {
        table.uuid('tenant').references('tenants.tenant');
        table.uuid('project_id').unsigned();
        table.uuid('status_id').unsigned().nullable();
        table.uuid('standard_status_id').unsigned().nullable();
        table.uuid('project_status_mapping_id').notNullable().defaultTo(knex.raw('gen_random_uuid()')).unique();
        table.string('custom_name', 50);
        table.integer('display_order').notNullable();
        table.boolean('is_visible').defaultTo(true);
        table.boolean('is_standard').notNullable().defaultTo(false);
        table.primary(['tenant', 'project_status_mapping_id']);
        
        table.foreign('standard_status_id')
        .references('standard_status_id')
        .inTable('standard_statuses')
        .onDelete('SET NULL');

        table.foreign(['tenant', 'project_id']).references(['tenant', 'project_id']).inTable('projects').onDelete('CASCADE');
        table.foreign(['tenant', 'status_id']).references(['tenant', 'status_id']).inTable('statuses').onDelete('SET NULL');
      });
};

exports.down = function(knex) {
  return knex.schema.dropTable('project_status_mappings');
};
