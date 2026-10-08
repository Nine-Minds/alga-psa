/**
 * Migration: Add service_id to project_phases and projects
 *
 * Extends the task-level service default (20251201120000_add_service_id_to_project_tasks)
 * up the hierarchy so a time entry can inherit its service from the task, else the
 * phase, else the project.
 *
 * - Both columns are nullable with default NULL (existing rows get NULL automatically)
 * - Foreign keys reference service_catalog
 * - Indexes added for efficient lookups
 * - Service deletion handling is done in application code
 */

exports.up = function(knex) {
  return knex.schema
    .alterTable('project_phases', function(table) {
      // Add nullable column - existing rows will have NULL (no backfill needed)
      table.uuid('service_id').nullable().defaultTo(null);

      // Multi-tenant foreign key - Citus style: ['tenant', 'service_id'] order
      table.foreign(['tenant', 'service_id'])
        .references(['tenant', 'service_id'])
        .inTable('service_catalog');

      // Index for lookups (same column order)
      table.index(['tenant', 'service_id'], 'idx_project_phases_tenant_service');
    })
    .alterTable('projects', function(table) {
      table.uuid('service_id').nullable().defaultTo(null);

      table.foreign(['tenant', 'service_id'])
        .references(['tenant', 'service_id'])
        .inTable('service_catalog');

      table.index(['tenant', 'service_id'], 'idx_projects_tenant_service');
    });
};

exports.down = function(knex) {
  return knex.schema
    .alterTable('projects', function(table) {
      table.dropIndex(['tenant', 'service_id'], 'idx_projects_tenant_service');
      table.dropForeign(['tenant', 'service_id']);
      table.dropColumn('service_id');
    })
    .alterTable('project_phases', function(table) {
      table.dropIndex(['tenant', 'service_id'], 'idx_project_phases_tenant_service');
      table.dropForeign(['tenant', 'service_id']);
      table.dropColumn('service_id');
    });
};
