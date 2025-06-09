exports.up = async function(knex) {
  // Add new columns to priorities table for tenant-specific priorities
  await knex.schema.alterTable('priorities', (table) => {
    table.integer('priority_level').notNullable().defaultTo(50); // Default to medium priority
    table.text('color').notNullable().defaultTo('#6B7280'); // Default gray color
    table.enum('item_type', ['ticket', 'project_task']).notNullable().defaultTo('ticket');
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Add unique constraint on tenant, priority_name and item_type combination
    table.unique(['tenant', 'priority_name', 'item_type']);
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('priorities', (table) => {
    table.dropUnique(['tenant', 'priority_name', 'item_type']);
    table.dropColumn('priority_level');
    table.dropColumn('color');
    table.dropColumn('item_type');
    table.dropColumn('updated_at');
  });
};