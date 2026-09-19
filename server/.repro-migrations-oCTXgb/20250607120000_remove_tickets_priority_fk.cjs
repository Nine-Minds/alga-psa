/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Remove the foreign key constraint on priority_id in tickets table
  // This allows priority_id to reference either standard_priorities or tenant-specific priorities
  await knex.schema.alterTable('tickets', (table) => {
    table.dropForeign(['tenant', 'priority_id']);
  });
  
  console.log('Removed foreign key constraint on tickets.priority_id to allow both standard and tenant-specific priorities');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Re-add the foreign key constraint if needed
  await knex.schema.alterTable('tickets', (table) => {
    table.foreign(['tenant', 'priority_id'])
      .references(['tenant', 'priority_id'])
      .inTable('priorities');
  });
};