exports.up = async function(knex) {
  console.log('='.repeat(80));
  console.log('Adding quote to document_associations entity_type constraint...');
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
      'quote',
      'team',
      'tenant',
      'ticket',
      'user'
    )) NOT VALID;
  `);
  console.log('   ✓ Added new constraint with quote entity type');

  // Add default folder templates for quotes
  const tenants = await knex('tenants').select('tenant');
  for (const { tenant } of tenants) {
    const existing = await knex('document_default_folders')
      .where({ tenant, entity_type: 'quote' })
      .first();

    if (!existing) {
      const now = new Date();
      await knex('document_default_folders').insert([
        {
          default_folder_id: knex.raw('gen_random_uuid()'),
          tenant,
          entity_type: 'quote',
          folder_path: '/Quotes',
          folder_name: 'Quotes',
          is_client_visible: true,
          sort_order: 0,
          created_at: now,
          updated_at: now,
        },
        {
          default_folder_id: knex.raw('gen_random_uuid()'),
          tenant,
          entity_type: 'quote',
          folder_path: '/Quotes/Generated',
          folder_name: 'Generated',
          is_client_visible: true,
          sort_order: 1,
          created_at: now,
          updated_at: now,
        },
        {
          default_folder_id: knex.raw('gen_random_uuid()'),
          tenant,
          entity_type: 'quote',
          folder_path: '/Quotes/Attachments',
          folder_name: 'Attachments',
          is_client_visible: true,
          sort_order: 2,
          created_at: now,
          updated_at: now,
        },
      ]);
      console.log(`   ✓ Added default quote folders for tenant ${tenant}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('✓ Migration completed successfully');
  console.log('='.repeat(80));
};

exports.down = async function(knex) {
  console.log('='.repeat(80));
  console.log('Removing quote from document_associations entity_type constraint...');
  console.log('='.repeat(80));

  // Remove quote document associations
  await knex('document_associations').where('entity_type', 'quote').del();

  // Remove default folder templates for quotes
  await knex('document_default_folders').where('entity_type', 'quote').del();

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
      'team',
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
