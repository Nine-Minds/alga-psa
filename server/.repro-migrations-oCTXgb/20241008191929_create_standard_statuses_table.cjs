exports.up = function(knex) {
  return knex.schema.createTable('standard_statuses', function(table) {
    table.uuid('standard_status_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable().primary();
    table.string('name', 50).notNullable();
    table.enum('item_type', ['project', 'project_task', 'ticket']).notNullable();
    table.integer('display_order').notNullable();
    table.uuid('tenant').references("tenant").inTable('tenants');
    table.unique(['name', 'item_type']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('standard_statuses');
};
