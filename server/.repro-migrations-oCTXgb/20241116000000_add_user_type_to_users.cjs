/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('users', (table) => {
      table.enu('user_type', ['internal', 'client']).notNullable().defaultTo('internal');
    });
};

/**
* @param { import("knex").Knex } knex
* @returns { Promise<void> }
*/
exports.down = function(knex) {
  return knex.schema.alterTable('users', (table) => {
      table.dropColumn('user_type');
    });
};
