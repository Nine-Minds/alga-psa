/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // Check if the column exists before trying to remove it
    const hasStorageLocation = await knex.schema.hasColumn('file_stores', 'storage_location');
    
    if (hasStorageLocation) {
        await knex.schema.alterTable('file_stores', table => {
            table.dropColumn('storage_location');
        });
    }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Check if the column doesn't exist before adding it back
    const hasStorageLocation = await knex.schema.hasColumn('file_stores', 'storage_location');
    
    if (!hasStorageLocation) {
        await knex.schema.alterTable('file_stores', table => {
            table.string('storage_location');
        });
    }
};
