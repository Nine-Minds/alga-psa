/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('users', table => {
    table.timestamp('last_login_at', { useTz: true }).nullable();
    table.string('last_login_method', 50).nullable(); // 'credentials', 'google', 'keycloak', etc.
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('users', table => {
    table.dropColumn('last_login_at');
    table.dropColumn('last_login_method');
  });
};
