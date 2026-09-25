/**
 * Allows a document to be associated with an opportunity.
 *
 * Deals arrive with paperwork of their own — RFPs, scoping notes, signed
 * letters of intent — that belongs to the opportunity rather than to the
 * quote it eventually produces.
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
      'interaction',
      'invoice',
      'opportunity',
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
  await knex('document_associations').where('entity_type', 'opportunity').del();

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
      'interaction',
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
