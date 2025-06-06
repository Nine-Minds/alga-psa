exports.up = async function(knex) {
  // Create standard_priorities reference table (not distributed)
  await knex.schema.createTable('standard_priorities', (table) => {
    table.uuid('priority_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.text('priority_name').notNullable();
    table.integer('priority_level').notNullable(); // For ordering: 1=highest, 99=lowest
    table.text('color').notNullable(); // Hex color code
    table.enum('item_type', ['ticket', 'project_task']).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Unique constraint on priority_name and item_type combination
    table.unique(['priority_name', 'item_type']);
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTable('standard_priorities');
};