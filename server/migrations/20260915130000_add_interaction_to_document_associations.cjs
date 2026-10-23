/**
 * Allows a document to be associated with an interaction.
 *
 * Call transcripts are filed as documents on the contact and client the call
 * was matched to; linking them to the Call interaction as well lets the
 * interaction view show the transcript that belongs to that specific call.
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
  await knex('document_associations').where('entity_type', 'interaction').del();

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
