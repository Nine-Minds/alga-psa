/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
    await knex.schema.alterTable('time_entries', (table) => {
        table
            .foreign(['tenant', 'created_by'])
            .references(['tenant', 'user_id'])
            .inTable('users');

        table
            .foreign(['tenant', 'updated_by'])
            .references(['tenant', 'user_id'])
            .inTable('users');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
    await knex.schema.alterTable('time_entries', (table) => {
        table.dropForeign(['tenant', 'created_by']);
        table.dropForeign(['tenant', 'updated_by']);
    });
};

