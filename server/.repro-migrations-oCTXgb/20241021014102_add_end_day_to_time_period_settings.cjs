
exports.up = function (knex) {
    return knex.schema.alterTable('time_period_settings', (table) => {
        table.integer('end_day').notNullable().defaultTo(1);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema.alterTable('time_period_settings', (table) => {
        table.dropColumn('end_day');
    });
};
