/**
 * Update entity_type constraints from 'company' to 'client'
 *
 * This migration updates check constraints and data in tables that have
 * entity_type columns to use 'client' instead of 'company'.
 *
 * Affected tables:
 * - document_associations
 * - asset_associations
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

exports.config = { transaction: false };

exports.up = async function(knex) {
  console.log('='.repeat(80));
  console.log('Updating entity_type constraints from company to client...');
  console.log('='.repeat(80));

  // Update document_associations check constraint
  const docAssocExists = await knex.schema.hasTable('document_associations');
  if (docAssocExists) {
    console.log('\nUpdating document_associations...');

    try {
      // Drop old constraint FIRST (allows us to update to 'client')
      console.log('  Dropping old check constraint...');
      await knex.raw(`
        ALTER TABLE document_associations
        DROP CONSTRAINT IF EXISTS document_associations_entity_type_check
      `);

      // Update existing 'company' values to 'client'
      console.log('  Updating entity_type data from company to client...');
      const result = await knex.raw(`
        UPDATE document_associations
        SET entity_type = 'client'
        WHERE entity_type = 'company'
      `);
      console.log(`    ✓ Updated ${result.rowCount || 0} rows`);

      // Check what entity_type values exist in the table
      console.log('  Checking existing entity_type values...');
      const existingTypes = await knex.raw(`
        SELECT DISTINCT entity_type
        FROM document_associations
        WHERE entity_type IS NOT NULL
        ORDER BY entity_type
      `);
      console.log(`    Found entity_type values: ${existingTypes.rows.map(r => r.entity_type).join(', ')}`);

      // Add new constraint with 'client' instead of 'company'
      // Include all existing values plus future-proofing with 'project'
      // Add as NOT VALID first to avoid checking existing rows, then validate
      console.log('  Adding new check constraint with client (NOT VALID)...');
      await knex.raw(`
        ALTER TABLE document_associations
        ADD CONSTRAINT document_associations_entity_type_check
        CHECK (entity_type IN ('asset', 'client', 'contact', 'project', 'project_task', 'tenant', 'ticket', 'user'))
        NOT VALID
      `);

      // Skip validation for now - the NOT VALID constraint will still prevent new bad data
      // Validation might fail in Citus distributed environments due to timing/visibility issues
      console.log('  ⚠️  Skipping validation (constraint is NOT VALID but will prevent new violations)');
      console.log('    ✓ Updated constraint to use client instead of company');
    } catch (error) {
      console.error(`    ✗ Failed to update document_associations: ${error.message}`);
      throw error;
    }
  } else {
    console.log('  ⚠ document_associations table does not exist, skipping');
  }

  // Update asset_associations if it has entity_type constraints
  const assetAssocExists = await knex.schema.hasTable('asset_associations');
  if (assetAssocExists) {
    console.log('\nUpdating asset_associations...');

    try {
      const hasConstraint = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'asset_associations'::regclass
          AND conname LIKE '%entity_type%'
          AND contype = 'c'
        ) as exists
      `);

      if (hasConstraint.rows[0].exists) {
        console.log('  Dropping old check constraint...');
        await knex.raw(`
          ALTER TABLE asset_associations
          DROP CONSTRAINT IF EXISTS asset_associations_entity_type_check
        `);

        console.log('  Updating entity_type data from company to client...');
        const result = await knex.raw(`
          UPDATE asset_associations
          SET entity_type = 'client'
          WHERE entity_type = 'company'
        `);
        console.log(`    ✓ Updated ${result.rowCount || 0} rows`);

        console.log('  Adding new check constraint with client...');
        await knex.raw(`
          ALTER TABLE asset_associations
          ADD CONSTRAINT asset_associations_entity_type_check
          CHECK (entity_type IN ('client', 'contact', 'ticket', 'project'))
        `);
        console.log('    ✓ Updated constraint to use client instead of company');
      } else {
        console.log('  ⚠ No entity_type constraint found, skipping');
      }
    } catch (error) {
      console.error(`    ✗ Failed to update asset_associations: ${error.message}`);
      throw error;
    }
  } else {
    console.log('  ⚠ asset_associations table does not exist, skipping');
  }

  // Verification
  console.log('\n' + '='.repeat(80));
  console.log('Verification:');

  if (docAssocExists) {
    const companyCount = await knex('document_associations')
      .where('entity_type', 'company')
      .count('* as count');
    const clientCount = await knex('document_associations')
      .where('entity_type', 'client')
      .count('* as count');

    console.log(`  document_associations: ${companyCount[0].count} company rows, ${clientCount[0].count} client rows`);

    if (parseInt(companyCount[0].count) > 0) {
      throw new Error('Still have company entity_type values in document_associations!');
    }
  }

  if (assetAssocExists) {
    const companyCount = await knex('asset_associations')
      .where('entity_type', 'company')
      .count('* as count');
    const clientCount = await knex('asset_associations')
      .where('entity_type', 'client')
      .count('* as count');

    console.log(`  asset_associations: ${companyCount[0].count} company rows, ${clientCount[0].count} client rows`);

    if (parseInt(companyCount[0].count) > 0) {
      throw new Error('Still have company entity_type values in asset_associations!');
    }
  }

  console.log('='.repeat(80));
  console.log('✓ Entity type constraints updated successfully');
  console.log('='.repeat(80));
};

exports.down = async function(knex) {
  console.log('='.repeat(80));
  console.log('Rolling back entity_type constraints from client to company...');
  console.log('='.repeat(80));

  // Restore document_associations
  const docAssocExists = await knex.schema.hasTable('document_associations');
  if (docAssocExists) {
    console.log('\nRestoring document_associations...');

    try {
      // Restore 'client' values back to 'company'
      console.log('  Updating entity_type data from client to company...');
      const result = await knex.raw(`
        UPDATE document_associations
        SET entity_type = 'company'
        WHERE entity_type = 'client'
      `);
      console.log(`    ✓ Updated ${result.rowCount || 0} rows`);

      // Drop new constraint
      console.log('  Dropping client constraint...');
      await knex.raw(`
        ALTER TABLE document_associations
        DROP CONSTRAINT IF EXISTS document_associations_entity_type_check
      `);

      // Restore old constraint
      console.log('  Restoring company constraint...');
      await knex.raw(`
        ALTER TABLE document_associations
        ADD CONSTRAINT document_associations_entity_type_check
        CHECK (entity_type IN ('user', 'ticket', 'company', 'contact', 'asset', 'project_task', 'tenant'))
      `);
      console.log('    ✓ Restored constraint to use company instead of client');
    } catch (error) {
      console.error(`    ✗ Failed to restore document_associations: ${error.message}`);
      throw error;
    }
  }

  // Restore asset_associations
  const assetAssocExists = await knex.schema.hasTable('asset_associations');
  if (assetAssocExists) {
    console.log('\nRestoring asset_associations...');

    try {
      console.log('  Updating entity_type data from client to company...');
      const result = await knex.raw(`
        UPDATE asset_associations
        SET entity_type = 'company'
        WHERE entity_type = 'client'
      `);
      console.log(`    ✓ Updated ${result.rowCount || 0} rows`);

      console.log('  Dropping client constraint...');
      await knex.raw(`
        ALTER TABLE asset_associations
        DROP CONSTRAINT IF EXISTS asset_associations_entity_type_check
      `);

      console.log('  Restoring company constraint...');
      await knex.raw(`
        ALTER TABLE asset_associations
        ADD CONSTRAINT asset_associations_entity_type_check
        CHECK (entity_type IN ('company', 'contact', 'ticket', 'project'))
      `);
      console.log('    ✓ Restored constraint to use company instead of client');
    } catch (error) {
      console.error(`    ✗ Failed to restore asset_associations: ${error.message}`);
      throw error;
    }
  }

  console.log('='.repeat(80));
  console.log('✓ Rollback completed');
  console.log('='.repeat(80));
};
