/**
 * Adds is_temporary flag to workflow_form_definitions to support inline workflow forms
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('workflow_form_definitions', (table) => {
    table.boolean('is_temporary').notNullable().defaultTo(false);
    table.index('is_temporary');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('workflow_form_definitions', (table) => {
    table.dropIndex('is_temporary');
    table.dropColumn('is_temporary');
  });
};