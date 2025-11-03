/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Add new columns to comments table to support project tasks and phases
  await knex.schema.alterTable('comments', table => {
    // Make ticket_id nullable since comments can now be on tasks or phases
    table.uuid('ticket_id').nullable().alter();

    // Add columns for project task and phase associations
    table.uuid('project_task_id').nullable();
    table.uuid('project_phase_id').nullable();

    // Add check constraint using raw SQL to avoid naming issues
  });

  // Add check constraint separately with raw SQL
  await knex.raw(`
    ALTER TABLE comments
    ADD CONSTRAINT chk_comment_single_association
    CHECK ((
      (ticket_id IS NOT NULL)::int +
      (project_task_id IS NOT NULL)::int +
      (project_phase_id IS NOT NULL)::int
    ) = 1)
  `);

  // Add foreign key constraints
  await knex.schema.alterTable('comments', table => {
    table.foreign(['tenant', 'project_task_id'])
      .references(['tenant', 'task_id'])
      .inTable('project_tasks')
      .onDelete('CASCADE');

    table.foreign(['tenant', 'project_phase_id'])
      .references(['tenant', 'phase_id'])
      .inTable('project_phases')
      .onDelete('CASCADE');
  });

  // Add indexes for performance
  await knex.schema.alterTable('comments', table => {
    table.index(['tenant', 'project_task_id'], 'idx_comments_project_task');
    table.index(['tenant', 'project_phase_id'], 'idx_comments_project_phase');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Drop indexes
  await knex.schema.alterTable('comments', table => {
    table.dropIndex(['tenant', 'project_task_id'], 'idx_comments_project_task');
    table.dropIndex(['tenant', 'project_phase_id'], 'idx_comments_project_phase');
  });

  // Drop foreign key constraints
  await knex.schema.alterTable('comments', table => {
    table.dropForeign(['tenant', 'project_task_id']);
    table.dropForeign(['tenant', 'project_phase_id']);
  });

  // Drop check constraint
  await knex.raw('ALTER TABLE comments DROP CONSTRAINT IF EXISTS chk_comment_single_association');

  // Remove columns
  await knex.schema.alterTable('comments', table => {
    table.dropColumn('project_task_id');
    table.dropColumn('project_phase_id');

    // Make ticket_id required again
    table.uuid('ticket_id').notNullable().alter();
  });
};