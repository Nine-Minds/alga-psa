exports.up = async function(knex) {
    await knex.schema.alterTable('transactions', (table) => {
        table.decimal('balance_after', 15, 2).nullable();
    });
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function(knex) {
    await knex.schema.alterTable('transactions', (table) => {
        table.dropColumn('balance_after');
    });
};
