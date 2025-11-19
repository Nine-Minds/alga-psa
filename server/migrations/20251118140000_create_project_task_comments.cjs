/**
 * Migration: Create project_task_comments table
 *
 * Creates table for internal-only comments on project tasks with:
 * - BlockNote rich text content with embedded mentions
 * - Author tracking (internal users only)
 * - Cascade delete when task is deleted
 * - CitusDB-compatible primary key
 */

exports.up = function(knex) {
  return knex.schema.createTable('project_task_comments', (table) => {
    // Tenant and primary key
    table.uuid('tenant').notNullable();
    table.uuid('task_comment_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();

    // Task reference (REQUIRED - tasks only)
    table.uuid('task_id').notNullable();

    // User info (internal users only)
    table.uuid('user_id').notNullable();
    table.text('author_type').notNullable().defaultTo('internal');

    // Content (BlockNote format with embedded mentions)
    table.text('note').notNullable();  // BlockNote JSON
    table.text('markdown_content');

    // Metadata
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at');
    table.timestamp('edited_at');

    // Primary key (includes tenant for CitusDB)
    table.primary(['task_comment_id', 'tenant']);

    // Foreign keys
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'task_id'])
      .references(['tenant', 'task_id'])
      .inTable('project_tasks')
      .onDelete('CASCADE');
    table.foreign(['tenant', 'user_id'])
      .references(['tenant', 'user_id'])
      .inTable('users');

    // Check constraint - only internal users
    table.check('?? = ?', ['author_type', 'internal']);

    // Indexes for performance
    table.index(['tenant', 'task_id'], 'idx_project_task_comments_tenant_task');
    table.index(['tenant', 'user_id'], 'idx_project_task_comments_user');
    table.index(['tenant', 'created_at'], 'idx_project_task_comments_created');
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('project_task_comments');
};
