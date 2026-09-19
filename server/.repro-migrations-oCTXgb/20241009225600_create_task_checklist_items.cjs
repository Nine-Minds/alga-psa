exports.up = function(knex) {
  return knex.schema.createTable('task_checklist_items', function(table) {
    table.uuid('tenant').notNullable();
    table.uuid('checklist_item_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('task_id').notNullable();
    table.text('item_name').notNullable();
    table.text('description');
    table.uuid('assigned_to');
    table.boolean('completed').notNullable().defaultTo(false);
    table.timestamp('due_date');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.integer('order_number');
    table
      .foreign(['tenant', 'task_id'])
      .references(['tenant', 'task_id'])
      .inTable('project_tasks')
      .onDelete('CASCADE');
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('task_checklist_items');
};
