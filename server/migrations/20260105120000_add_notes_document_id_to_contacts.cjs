/**
 * Migration: Add notes_document_id to contacts table
 *
 * This migration adds support for BlockNote-formatted notes on contacts,
 * mirroring the functionality already present in assets and clients (companies).
 *
 * The notes_document_id column links to a document that stores the BlockNote
 * rich text content via the document_block_content table.
 *
 * Note: No FK constraint is added due to Citus limitations with ON DELETE SET NULL.
 * Document deletion cleanup is handled in backend code (contactNoteActions.ts).
 */

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Add notes_document_id column to contacts
  await knex.schema.alterTable('contacts', (table) => {
    table.uuid('notes_document_id').nullable();
  });

  // Add partial index for performance (only on rows with notes)
  await knex.raw(`
    CREATE INDEX idx_contacts_notes_document
    ON contacts(tenant, notes_document_id)
    WHERE notes_document_id IS NOT NULL
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Drop the index
  await knex.raw('DROP INDEX IF EXISTS idx_contacts_notes_document');

  // Drop the column
  await knex.schema.alterTable('contacts', (table) => {
    table.dropColumn('notes_document_id');
  });
};
