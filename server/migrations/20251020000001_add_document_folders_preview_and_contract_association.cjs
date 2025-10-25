exports.up = async function(knex) {
  console.log('='.repeat(80));
  console.log('Adding document folders and contract association support...');
  console.log('='.repeat(80));

  // 1. Add folder_path and preview columns to documents table
  console.log('\n1. Adding folder_path and preview columns to documents table...');
  await knex.raw(`
    ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS folder_path VARCHAR(500),
    ADD COLUMN IF NOT EXISTS thumbnail_file_id UUID,
    ADD COLUMN IF NOT EXISTS preview_file_id UUID,
    ADD COLUMN IF NOT EXISTS preview_generated_at TIMESTAMPTZ;
  `);
  console.log('   ✓ folder_path and preview columns added');

  // 2. Add indexes for folder queries
  console.log('\n2. Adding indexes for folder queries...');

  // Index for full folder path queries
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_documents_tenant_folder_path
    ON documents(tenant, folder_path)
    WHERE folder_path IS NOT NULL;
  `);
  console.log('   ✓ Full folder path index created');

  // Index for first-level folder queries (up to second slash)
  // This speeds up folder tree navigation and first-level folder filtering
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_documents_tenant_first_level_folder
    ON documents(tenant, (
      CASE
        WHEN folder_path IS NULL THEN NULL
        WHEN folder_path !~ '/' THEN folder_path
        ELSE SUBSTRING(folder_path FROM '^/?([^/]+)')
      END
    ))
    WHERE folder_path IS NOT NULL;
  `);
  console.log('   ✓ First-level folder index created');

  // 3. Update document_associations CHECK constraint to include 'contract'
  console.log('\n3. Updating document_associations entity_type constraint...');

  // Drop existing constraint
  await knex.raw(`
    ALTER TABLE document_associations
    DROP CONSTRAINT IF EXISTS document_associations_entity_type_check;
  `);
  console.log('   ✓ Dropped old constraint');

  // Add new constraint with 'contract' included
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
  console.log('   ✓ Added new constraint with contract entity type');

  console.log('\n' + '='.repeat(80));
  console.log('✓ Migration completed successfully');
  console.log('='.repeat(80));
};

exports.down = async function(knex) {
  console.log('='.repeat(80));
  console.log('Rolling back document folders and contract association...');
  console.log('='.repeat(80));

  // 1. Remove folder_path and preview columns
  console.log('\n1. Removing folder_path and preview columns...');
  await knex.raw(`
    ALTER TABLE documents
    DROP COLUMN IF EXISTS folder_path,
    DROP COLUMN IF EXISTS thumbnail_file_id,
    DROP COLUMN IF EXISTS preview_file_id,
    DROP COLUMN IF EXISTS preview_generated_at;
  `);
  console.log('   ✓ folder_path and preview columns removed');

  // 2. Drop indexes
  console.log('\n2. Dropping folder_path indexes...');
  await knex.raw(`
    DROP INDEX IF EXISTS idx_documents_tenant_folder_path;
  `);
  await knex.raw(`
    DROP INDEX IF EXISTS idx_documents_tenant_first_level_folder;
  `);
  console.log('   ✓ Indexes dropped');

  // 3. Restore old constraint without 'contract'
  console.log('\n3. Restoring old entity_type constraint...');

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
      'project_task',
      'tenant',
      'ticket',
      'user'
    ));
  `);
  console.log('   ✓ Constraint restored');

  console.log('\n' + '='.repeat(80));
  console.log('✓ Rollback completed');
  console.log('='.repeat(80));
};

exports.config = { transaction: false };
