/**
 * Distribute final set of tables with tenant column
 */
const { 
  dropAndCaptureForeignKeys, 
  recreateForeignKeys 
} = require('./utils/foreign_key_manager.cjs');
exports.config = { transaction: false };

exports.up = async function(knex) {
  // Check if Citus is enabled
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);
  
  if (!citusEnabled.rows[0].enabled) {
    console.log('Citus not enabled, skipping table distribution');
    return;
  }

  console.log('Distributing final set of tables...');
  
  const tables = [
    'company_email_settings',
    'credit_allocations',
    'email_providers',
    'notification_logs',
    'notification_settings',
    'portal_invitations',
    'sessions',
    'storage_buckets',
    'inbound_ticket_defaults',
    'gmail_processed_history',
    'google_email_provider_config',
    'microsoft_email_provider_config',
    'email_provider_configs',
    'email_provider_health',
    'composite_tax_mappings',
    'asset_document_associations',
    'asset_maintenance_history',
    'asset_maintenance_notifications',
    'asset_service_history',
    'asset_ticket_associations',
    'asset_types',
    'credit_reconciliation_reports',
    'credit_tracking',
    'file_references',
    'file_stores'
  ];
  
  for (const table of tables) {
    try {
      console.log(`\nProcessing ${table}...`);
      
      // Check if table exists
      const tableExists = await knex.schema.hasTable(table);
      if (!tableExists) {
        console.log(`  Table ${table} does not exist, skipping`);
        continue;
      }
      
      // Check if table has tenant column
      const hasTenantColumn = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = '${table}' 
          AND column_name = 'tenant'
        ) as has_tenant
      `);
      
      if (!hasTenantColumn.rows[0].has_tenant) {
        console.log(`  Table ${table} does not have tenant column, skipping`);
        continue;
      }
      
      // Check if already distributed
      const isDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = '${table}'::regclass
        ) as distributed
      `);
      
      if (isDistributed.rows[0].distributed) {
        console.log(`  ${table} already distributed`);
        continue;
      }

      // Step 1: Capture and drop foreign key constraints


      console.log(`  Capturing and dropping foreign key constraints for ${table}...`);


      const capturedFKs = await dropAndCaptureForeignKeys(knex, table);
      
      // Step 2: Drop unique constraints with CASCADE
      console.log(`  Dropping unique constraints for ${table}...`);
      const uniqueConstraints = await knex.raw(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = '${table}'::regclass
        AND contype = 'u'
      `);
      
      for (const constraint of uniqueConstraints.rows) {
        try {
          await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint.conname} CASCADE`);
          console.log(`    ✓ Dropped constraint: ${constraint.conname} with CASCADE`);
        } catch (e) {
          console.log(`    - Could not drop ${constraint.conname}: ${e.message}`);
        }
      }
      
      // Step 2b: Drop check constraints
      console.log(`  Dropping check constraints for ${table}...`);
      const checkConstraints = await knex.raw(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = '${table}'::regclass
        AND contype = 'c'
        AND conname NOT LIKE '%_not_null'
      `);
      
      for (const constraint of checkConstraints.rows) {
        try {
          await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint.conname} CASCADE`);
          console.log(`    ✓ Dropped check constraint: ${constraint.conname}`);
        } catch (e) {
          console.log(`    - Could not drop check ${constraint.conname}: ${e.message}`);
        }
      }
      
      // Step 3: Drop triggers if any
      console.log(`  Dropping triggers for ${table}...`);
      const triggers = await knex.raw(`
        SELECT tgname
        FROM pg_trigger
        WHERE tgrelid = '${table}'::regclass
        AND tgisinternal = false
      `);
      
      for (const trigger of triggers.rows) {
        try {
          await knex.raw(`DROP TRIGGER IF EXISTS ${trigger.tgname} ON ${table}`);
          console.log(`    ✓ Dropped trigger: ${trigger.tgname}`);
        } catch (e) {
          console.log(`    - Could not drop trigger ${trigger.tgname}: ${e.message}`);
        }
      }
      
      // Step 4: Distribute the table
      console.log(`  Distributing ${table}...`);
      await knex.raw(`SELECT create_distributed_table('${table}', 'tenant', colocate_with => 'tenants')`);
      console.log(`    ✓ Distributed ${table}`);

      

      // Recreate foreign keys for this table

      console.log(`  Recreating foreign keys for ${table}...`);

      await recreateForeignKeys(knex, table, capturedFKs);
      
    } catch (error) {
      console.error(`  ✗ Failed to distribute ${table}: ${error.message}`);
      // Continue with other tables instead of throwing
      console.log(`  Continuing with remaining tables...`);
    }
  }
  
  console.log('\n✓ Final tables distribution completed');
};

exports.down = async function(knex) {
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);
  
  if (!citusEnabled.rows[0].enabled) {
    return;
  }

  console.log('Undistributing final tables...');
  
  const tables = [
    'file_stores',
    'file_references',
    'credit_tracking',
    'credit_reconciliation_reports',
    'asset_types',
    'asset_ticket_associations',
    'asset_service_history',
    'asset_maintenance_notifications',
    'asset_maintenance_history',
    'asset_document_associations',
    'composite_tax_mappings',
    'email_provider_health',
    'email_provider_configs',
    'microsoft_email_provider_config',
    'google_email_provider_config',
    'gmail_processed_history',
    'inbound_ticket_defaults',
    'storage_buckets',
    'sessions',
    'portal_invitations',
    'notification_settings',
    'notification_logs',
    'email_providers',
    'credit_allocations',
    'company_email_settings'
  ];
  
  for (const table of tables) {
    try {
      const tableExists = await knex.schema.hasTable(table);
      if (!tableExists) continue;
      
      const isDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = '${table}'::regclass
        ) as distributed
      `);
      
      if (isDistributed.rows[0].distributed) {
        await knex.raw(`SELECT undistribute_table('${table}')`);
        console.log(`  ✓ Undistributed ${table}`);
      }
    } catch (error) {
      console.error(`  ✗ Failed to undistribute ${table}: ${error.message}`);
    }
  }
};