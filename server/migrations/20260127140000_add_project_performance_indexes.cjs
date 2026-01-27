/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // Index for task_checklist_items - critical for kanban checklist loading
    // Query pattern: WHERE task_id = ? AND tenant = ? ORDER BY order_number
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_task_checklist_items_tenant_task_order
        ON task_checklist_items (tenant, task_id, order_number)
    `);

    // Index for project_ticket_links - speeds up ticket link lookups per task
    // Query pattern: WHERE task_id = ? AND tenant = ?
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_project_ticket_links_tenant_task
        ON project_ticket_links (tenant, task_id)
    `);

    // Index for project_task_dependencies - improves cycle detection queries
    // Query pattern: WHERE predecessor_task_id = ? AND tenant = ? AND dependency_type IN (...)
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_project_task_deps_tenant_pred_type
        ON project_task_dependencies (tenant, predecessor_task_id, dependency_type)
    `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    await knex.schema.raw('DROP INDEX IF EXISTS idx_task_checklist_items_tenant_task_order');
    await knex.schema.raw('DROP INDEX IF EXISTS idx_project_ticket_links_tenant_task');
    await knex.schema.raw('DROP INDEX IF EXISTS idx_project_task_deps_tenant_pred_type');
};
