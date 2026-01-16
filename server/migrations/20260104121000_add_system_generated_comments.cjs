/**
 * Marks system-generated comments that should not be editable/deletable.
 * Used for bundled-ticket mirrored updates.
 */

exports.up = async function up(knex) {
  await knex.schema.alterTable('comments', (table) => {
    table.boolean('is_system_generated').notNullable().defaultTo(false);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('comments', (table) => {
    table.dropColumn('is_system_generated');
  });
};

