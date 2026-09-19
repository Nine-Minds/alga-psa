exports.up = function(knex) {
  return knex.schema.alterTable('statuses', function(table) {
    // First, create the item_type column
    table.enum('item_type', ['project', 'project_task', 'ticket']);

    // Then, copy the status_type into item_type
    knex.raw('UPDATE statuses SET item_type = status_type')
      .then(() => {
        // Finally, set the non-nullable constraint on item_type
        table.enum('item_type', ['project', 'project_task', 'ticket']).notNullable().alter();

        // Continue with the rest of the alterations
    table.uuid('standard_status_id').unsigned().references('standard_status_id').inTable('standard_statuses');
    table.boolean('is_custom').defaultTo(false);
    table.dropColumn('status_type');
    table.unique(['name', 'item_type']);
  });
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('statuses', function(table) {
    table.dropColumn('item_type');
    table.dropColumn('standard_status_id');
    table.dropColumn('is_custom');
    table.enum('status_type', ['project_task', 'project']).notNullable();
    table.dropUnique(['name', 'item_type']);
  });
};
