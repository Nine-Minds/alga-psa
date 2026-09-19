/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // Drop all storage-related tables
    // Update file_stores table to remove location references
    await knex.schema.alterTable('file_stores', table => {
        table.dropForeign(['tenant', 'bucket_id']);
        table.dropColumn('bucket_id');
        table.string('storage_location').notNullable().comment('Storage location ID from environment config');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Update file_stores table to restore bucket_id
    await knex.schema.alterTable('file_stores', table => {
        table.dropColumn('storage_location');
        table.uuid('bucket_id').notNullable();
        table.foreign('bucket_id').references('bucket_id').inTable('storage_buckets');
    });
};
