/**
 * Migration: Add notes_document_id to assets table
 *
 * Following the same pattern as companies.notes_document_id, this enables
 * rich BlockNote-formatted notes on assets using the existing document system.
 *
 * The 1:1 relationship works as follows:
 * 1. When user creates a note, create a document in `documents` table
 * 2. Store BlockNote JSON in `document_block_content.block_data`
 * 3. Link document to asset via `assets.notes_document_id`
 * 4. Use existing document actions (createBlockDocument, getBlockContent, updateBlockContent)
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
    return knex.schema.alterTable('assets', function(table) {
        // Add notes_document_id column
        table.uuid('notes_document_id').nullable();

        // Add composite foreign key constraint including tenant for proper multi-tenant isolation
        // Note: ON DELETE SET NULL is not supported by Citus when distribution key (tenant)
        // is included in the FK. Document deletion cleanup must be handled in application code.
        table
            .foreign(['tenant', 'notes_document_id'])
            .references(['tenant', 'document_id'])
            .inTable('documents');

        // Add index for efficient lookups
        table.index(['tenant', 'notes_document_id'], 'idx_assets_notes_document');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
    return knex.schema.alterTable('assets', function(table) {
        // Drop the index first
        table.dropIndex(['tenant', 'notes_document_id'], 'idx_assets_notes_document');
        // Drop the foreign key constraint
        table.dropForeign(['tenant', 'notes_document_id']);
        // Then drop the column
        table.dropColumn('notes_document_id');
    });
};
