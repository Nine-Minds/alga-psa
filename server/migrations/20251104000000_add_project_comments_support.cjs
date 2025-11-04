bef/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Create project_task_comment table
  await knex.schema.createTable('project_task_comment', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('project_task_comment_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('project_task_id').notNullable();
    table.uuid('user_id').notNullable();
    table.text('note').notNullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    // Set composite primary key with tenant and project_task_comment_id
    table.primary(['tenant', 'project_task_comment_id']);

    // Add indexes for performance
    table.index(['tenant', 'project_task_id'], 'idx_project_task_comment_task');
    table.index(['tenant', 'user_id'], 'idx_project_task_comment_user');
    table.index(['tenant', 'created_at'], 'idx_project_task_comment_created');
  });

  // Create project_phase_comment table
  await knex.schema.createTable('project_phase_comment', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('project_phase_comment_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('project_phase_id').notNullable();
    table.uuid('user_id').notNullable();
    table.text('note').notNullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    // Set composite primary key with tenant and project_phase_comment_id
    table.primary(['tenant', 'project_phase_comment_id']);

    // Add indexes for performance
    table.index(['tenant', 'project_phase_id'], 'idx_project_phase_comment_phase');
    table.index(['tenant', 'user_id'], 'idx_project_phase_comment_user');
    table.index(['tenant', 'created_at'], 'idx_project_phase_comment_created');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Drop indexes first, then tables
  // Note: Indexes are automatically dropped when the table is dropped,
  // but listing them explicitly for clarity and consistency

  // Drop project_phase_comment table (indexes will be dropped automatically)
  await knex.schema.dropTableIfExists('project_phase_comment');

  // Drop project_task_comment table (indexes will be dropped automatically)
  await knex.schema.dropTableIfExists('project_task_comment');
};