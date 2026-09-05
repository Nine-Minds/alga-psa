/**
 * Allows a document to be associated with another document.
 *
 * Images pasted into a KB article are uploaded as their own documents. Without
 * a link back to the article they live in, they are unfindable in the library
 * and nothing ties them to the article for cleanup. A KB article is backed by a
 * documents row (kb_articles.document_id), so the association is document ->
 * document.
 */
exports.up = async function up(knex) {
  await knex.raw(`
    ALTER TABLE document_associations
    DROP CONSTRAINT IF EXISTS document_associations_entity_type_check;
  `);

  await knex.raw(`
    ALTER TABLE document_associations
    ADD CONSTRAINT document_associations_entity_type_check
    CHECK (entity_type IN (
      'asset',
      'client',
      'contact',
      'contract',
      'document',
      'invoice',
      'project_task',
      'quote',
      'sales_order',
      'team',
      'tenant',
      'ticket',
      'user'
    )) NOT VALID;
  `);
};

exports.down = async function down(knex) {
  await knex('document_associations').where('entity_type', 'document').del();

  await knex.raw(`
    ALTER TABLE document_associations
    DROP CONSTRAINT IF EXISTS document_associations_entity_type_check;
  `);

  await knex.raw(`
    ALTER TABLE document_associations
    ADD CONSTRAINT document_associations_entity_type_check
    CHECK (entity_type IN (
      'asset',
      'client',
      'contact',
      'contract',
      'invoice',
      'project_task',
      'quote',
      'sales_order',
      'team',
      'tenant',
      'ticket',
      'user'
    )) NOT VALID;
  `);
};
