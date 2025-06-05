/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.transaction(async (trx) => {
    // Remove the foreign key constraint and system_type_id column
    // Use raw SQL to handle the case where the constraint might not exist
    await trx.raw(`
      ALTER TABLE interaction_types 
      DROP CONSTRAINT IF EXISTS interaction_types_system_type_id_foreign
    `);
    
    await trx.schema.alterTable('interaction_types', (table) => {
      table.dropColumn('system_type_id');
    });
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.transaction(async (trx) => {
    // Re-add the system_type_id column and foreign key constraint
    await trx.schema.alterTable('interaction_types', (table) => {
      table.uuid('system_type_id').nullable();
      table.foreign('system_type_id').references('system_interaction_types.type_id');
    });
  });
};