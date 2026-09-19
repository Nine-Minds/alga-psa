/**
 * Drop legacy main_entry_point column from extensions table (v1 removal)
 */

exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('extensions', 'main_entry_point');
  if (hasColumn) {
    await knex.schema.alterTable('extensions', (table) => {
      table.dropColumn('main_entry_point');
    });
  }
};

exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('extensions', 'main_entry_point');
  if (!hasColumn) {
    await knex.schema.alterTable('extensions', (table) => {
      table.string('main_entry_point');
    });
  }
};

