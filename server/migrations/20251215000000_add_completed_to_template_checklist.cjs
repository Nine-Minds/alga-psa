/**
 * Add completed field to project_template_checklist_items table
 * This allows templates to have pre-completed checklist items
 */

exports.up = async function(knex) {
  await knex.schema.alterTable('project_template_checklist_items', (table) => {
    table.boolean('completed').defaultTo(false).notNullable();
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('project_template_checklist_items', (table) => {
    table.dropColumn('completed');
  });
};
