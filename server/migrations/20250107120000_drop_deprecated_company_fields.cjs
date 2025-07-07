/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Drop deprecated columns from companies table
  await knex.schema.alterTable('companies', function(table) {
    table.dropColumn('address');
    table.dropColumn('phone_no');
    table.dropColumn('email');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Re-add the columns if rolling back
  await knex.schema.alterTable('companies', function(table) {
    table.string('address');
    table.string('phone_no');
    table.string('email');
  });
};