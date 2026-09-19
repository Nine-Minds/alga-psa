/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
    return knex.schema.alterTable('documents', table => {
        // Add storage-related columns
        // table.string('tenant').nullable();
        table.uuid('file_id').nullable();
        table.foreign(['tenant', 'file_id']).references(['tenant', 'file_id']).inTable('file_stores').onDelete('SET NULL');
        table.uuid('storage_bucket_id').nullable();
        table.foreign(['tenant', 'storage_bucket_id']).references(['tenant', 'bucket_id']).inTable('storage_buckets').onDelete('SET NULL');
        table.string('storage_path').nullable();
        table.string('mime_type').nullable();
        table.bigInteger('file_size').nullable();

        // Add indexes for performance
        table.index('file_id');
        table.index('storage_bucket_id');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
    return knex.schema.alterTable('documents', table => {
        // Remove indexes
        table.dropIndex('file_id');
        table.dropIndex('storage_bucket_id');

        // Remove storage-related columns
        table.dropColumn('file_size');
        table.dropColumn('mime_type');
        table.dropColumn('storage_path');
        table.dropColumn('storage_bucket_id');
        table.dropColumn('file_id');
    });
};
