/**
 * Migration: Add service_id to project_tasks
 *
 * This migration adds an optional service_id field to project_tasks table
 * to enable automatic service prefill when creating time entries from tasks.
 *
 * - Column is nullable with default NULL (existing rows get NULL automatically)
 * - Foreign key references service_catalog
 * - Index added for efficient lookups
 * - Service deletion handling is done in application code
 */

exports.up = function(knex) {
  return knex.schema.alterTable('project_tasks', function(table) {
    // Add nullable column - existing rows will have NULL (no backfill needed)
    table.uuid('service_id').nullable().defaultTo(null);

    // Multi-tenant foreign key - Citus style: ['tenant', 'service_id'] order
    table.foreign(['tenant', 'service_id'])
      .references(['tenant', 'service_id'])
      .inTable('service_catalog');

    // Index for lookups (same column order)
    table.index(['tenant', 'service_id'], 'idx_project_tasks_tenant_service');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('project_tasks', function(table) {
    table.dropIndex(['tenant', 'service_id'], 'idx_project_tasks_tenant_service');
    table.dropForeign(['tenant', 'service_id']);
    table.dropColumn('service_id');
  });
};
