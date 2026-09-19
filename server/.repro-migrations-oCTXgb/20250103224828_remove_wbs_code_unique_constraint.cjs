/**
 * Remove unique constraint on wbs_code in project_tasks table
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    await knex.schema.alterTable('project_tasks', table => {
        table.dropUnique(['tenant', 'phase_id', 'wbs_code'], 'project_tasks_tenant_phase_id_wbs_code_unique');
    });
};

/**
 * Restore unique constraint on wbs_code in project_tasks table
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    await knex.schema.alterTable('project_tasks', table => {
        table.unique(['tenant', 'phase_id', 'wbs_code'], 'project_tasks_tenant_phase_id_wbs_code_unique');
    });
};
