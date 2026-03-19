/**
 * Adds is_client_visible column to both documents and document_folders tables,
 * plus an index on documents for client visibility queries.
 *
 * Combines:
 *  - add_is_client_visible_to_documents
 *  - add_is_client_visible_to_document_folders
 *  - add_documents_client_visibility_partial_index
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  // --- Step 1: Add is_client_visible to documents ---
  const hasDocuments = await knex.schema.hasTable('documents');
  if (hasDocuments) {
    const hasDocCol = await knex.schema.hasColumn('documents', 'is_client_visible');
    if (!hasDocCol) {
      await knex.schema.alterTable('documents', (table) => {
        table.boolean('is_client_visible').notNullable().defaultTo(false);
      });
    }
  }

  // --- Step 2: Add is_client_visible to document_folders ---
  const hasFolders = await knex.schema.hasTable('document_folders');
  if (hasFolders) {
    const hasFolderCol = await knex.schema.hasColumn('document_folders', 'is_client_visible');
    if (!hasFolderCol) {
      await knex.schema.alterTable('document_folders', (table) => {
        table.boolean('is_client_visible').notNullable().defaultTo(false);
      });
    }
  }

  // --- Step 3: Add index on documents.is_client_visible ---
  if (hasDocuments) {
    const hasVisibilityColumn = await knex.schema.hasColumn('documents', 'is_client_visible');
    if (hasVisibilityColumn) {
      // Plain index (no WHERE predicate) — partial indexes unsupported on CitusDB distributed tables
      await knex.raw(`
        CREATE INDEX IF NOT EXISTS idx_documents_tenant_client_visible_true
        ON documents (tenant, is_client_visible)
      `);
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  // Reverse step 3: drop index
  await knex.raw('DROP INDEX IF EXISTS idx_documents_tenant_client_visible_true');

  // Reverse step 2: drop column from document_folders
  const hasFolders = await knex.schema.hasTable('document_folders');
  if (hasFolders) {
    const hasFolderCol = await knex.schema.hasColumn('document_folders', 'is_client_visible');
    if (hasFolderCol) {
      await knex.schema.alterTable('document_folders', (table) => {
        table.dropColumn('is_client_visible');
      });
    }
  }

  // Reverse step 1: drop column from documents
  const hasDocuments = await knex.schema.hasTable('documents');
  if (hasDocuments) {
    const hasDocCol = await knex.schema.hasColumn('documents', 'is_client_visible');
    if (hasDocCol) {
      await knex.schema.alterTable('documents', (table) => {
        table.dropColumn('is_client_visible');
      });
    }
  }
};
