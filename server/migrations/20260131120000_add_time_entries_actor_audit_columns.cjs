/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
    await knex.schema.alterTable('time_entries', (table) => {
        table.uuid('created_by').nullable();
        table.uuid('updated_by').nullable();
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
    await knex.schema.alterTable('time_entries', (table) => {
        table.dropColumn('created_by');
        table.dropColumn('updated_by');
    });
};

