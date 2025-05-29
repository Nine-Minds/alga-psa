/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.transaction(async (trx) => {
    // Remove the foreign key constraint and system_type_id column
    await trx.schema.alterTable('interaction_types', (table) => {
      table.dropForeign('system_type_id');
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