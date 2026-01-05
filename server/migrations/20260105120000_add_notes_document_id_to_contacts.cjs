/**
 * Migration: Add notes_document_id to contacts table
 *
 * This migration adds support for BlockNote-formatted notes on contacts,
 * mirroring the functionality already present in assets and clients (companies).
 *
 * The notes_document_id column links to a document that stores the BlockNote
 * rich text content via the document_block_content table.
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

  // Add foreign key constraint with tenant isolation
  await knex.raw(`
    ALTER TABLE contacts
    ADD CONSTRAINT fk_contacts_notes_document
    FOREIGN KEY (tenant, notes_document_id)
    REFERENCES documents(tenant, document_id)
    ON DELETE SET NULL
  `);

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

  // Drop the foreign key constraint
  await knex.raw(`
    ALTER TABLE contacts
    DROP CONSTRAINT IF EXISTS fk_contacts_notes_document
  `);

  // Drop the column
  await knex.schema.alterTable('contacts', (table) => {
    table.dropColumn('notes_document_id');
  });
};
