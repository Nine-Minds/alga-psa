exports.up = async function(knex) {
  console.log('='.repeat(80));
  console.log('Adding team to document_associations entity_type constraint...');
  console.log('='.repeat(80));

  await knex.raw(`
    ALTER TABLE document_associations
    DROP CONSTRAINT IF EXISTS document_associations_entity_type_check;
  `);
  console.log('   ✓ Dropped old constraint');

  await knex.raw(`
    ALTER TABLE document_associations
    ADD CONSTRAINT document_associations_entity_type_check
    CHECK (entity_type IN (
      'asset',
      'client',
      'contact',
      'contract',
      'project_task',
      'team',
      'tenant',
      'ticket',
      'user'
    )) NOT VALID;
  `);
  console.log('   ✓ Added new constraint with team entity type');

  console.log('\n' + '='.repeat(80));
  console.log('✓ Migration completed successfully');
  console.log('='.repeat(80));
};

exports.down = async function(knex) {
  console.log('='.repeat(80));
  console.log('Removing team from document_associations entity_type constraint...');
  console.log('='.repeat(80));

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
      'tenant',
      'ticket',
      'user'
    )) NOT VALID;
  `);
  console.log('   ✓ Constraint restored');

  console.log('\n' + '='.repeat(80));
  console.log('✓ Rollback completed');
  console.log('='.repeat(80));
};

exports.config = { transaction: false };
