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
  await knex('document_associations').whereIn('entity_type', ['invoice', 'sales_order']).del();

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
      'project_task',
      'quote',
      'team',
      'tenant',
      'ticket',
      'user'
    )) NOT VALID;
  `);
};

exports.config = { transaction: false };
