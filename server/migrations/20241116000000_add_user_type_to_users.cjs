/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('users', (table) => {
      table.uuid('contact_id').references('contact_id').inTable('contacts').onDelete('SET NULL');
      // Allow existing client users to be migrated
      table.boolean('needs_contact_association').defaultTo(false);
    });
};

/**
* @param { import("knex").Knex } knex
* @returns { Promise<void> }
*/
exports.down = function(knex) {
  return knex.schema.alterTable('users', (table) => {
      table.dropColumn('contact_id');
      table.dropColumn('needs_contact_association');
    });
};