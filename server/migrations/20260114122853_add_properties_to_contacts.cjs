/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // Add properties JSONB column to contacts table for storing custom field values
    // This follows the same pattern as companies.properties
    await knex.schema.alterTable('contacts', (table) => {
        table.jsonb('properties');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    await knex.schema.alterTable('contacts', (table) => {
        table.dropColumn('properties');
    });
};
