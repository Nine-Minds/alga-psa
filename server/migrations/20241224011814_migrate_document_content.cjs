/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // First, migrate existing content to the new table
  await knex.raw(`
    INSERT INTO document_content (
      id,
      document_id,
      tenant,
      content,
      created_by_id,
      updated_by_id,
      created_at,
      updated_at
    )
    SELECT 
      gen_random_uuid(),
      document_id,
      tenant,
      content,
      created_by,
      COALESCE(edited_by, created_by),
      COALESCE(entered_at, NOW()),
      COALESCE(updated_at, NOW())
    FROM documents
    WHERE content IS NOT NULL AND content != '';
  `);

  // Then remove the content column from documents table
  return knex.schema.alterTable('documents', table => {
    table.dropColumn('content');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // First add the content column back
  await knex.schema.alterTable('documents', table => {
    table.text('content');
  });

  // Then migrate content back from document_content
  await knex.raw(`
    UPDATE documents d
    SET content = dc.content
    FROM document_content dc
    WHERE d.document_id = dc.document_id
    AND d.tenant = dc.tenant;
  `);

  // Finally drop the document_content table
  return knex.schema.dropTableIfExists('document_content');
};
