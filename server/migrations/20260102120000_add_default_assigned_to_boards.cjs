/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('boards', (table) => {
    table.uuid('default_assigned_to').nullable();
    // Foreign key with tenant for CitusDB compatibility
    // Note: ON DELETE SET NULL is not supported in CitusDB, so cleanup is handled
    // at the application level in userActions.ts (deleteUser/updateUser)
    table.foreign(['tenant', 'default_assigned_to'])
      .references(['tenant', 'user_id'])
      .inTable('users');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('boards', (table) => {
    table.dropForeign(['tenant', 'default_assigned_to']);
    table.dropColumn('default_assigned_to');
  });
};
