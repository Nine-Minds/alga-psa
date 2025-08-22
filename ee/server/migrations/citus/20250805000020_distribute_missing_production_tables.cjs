/**
 * Distribute tables that are missing from testing but present in production
 * This migration addresses inconsistencies between production and testing environments
 */
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

  console.log('Distributing missing production tables...');
  
  // Tables that should be distributed (have tenant column)
  const distributedTables = [
    'client_billing',
    'company_billing_cycles', 
    'company_plan_bundles',
    'company_tax_rates',
    'document_associations',
    'document_content',
    'plan_bundles',
    'service_types',
    'task_checklist_items',
    'tax_components',
    'tax_rates',
    'tax_regions',
    'time_period_types',
    // These might exist in production but not in our migrations
    'chats',
    'messages',
    'vectors',
    // Additional tables found to be local
    'api_keys',
    'audit_logs',
    'email_domains',
    'email_processed_messages',
    'email_rate_limits',
    'email_sending_logs',
    'telemetry_consent_log',
    'tenant_email_settings',
    'tenant_email_templates',
    'tenant_telemetry_settings',
    'user_notification_preferences'
  ];
  
  // Tables that should be reference tables (system-wide, no tenant)
  const referenceTables = [
    'standard_statuses',
    'tenant_companies',
    'time_period_settings',
    // Additional reference tables without tenant columns
    'composite_tax_mappings',
    'email_templates',
    'standard_service_categories',
    // 'system_event_catalog', // Has triggers, cannot be distributed with Citus
    'tax_holidays',
    'tax_rate_thresholds'
  ];
  
  // Process distributed tables
  for (const table of distributedTables) {
    try {
      console.log(`\nProcessing ${table} for distribution...`);
      
      // Check if table exists
      const tableExists = await knex.schema.hasTable(table);
      if (!tableExists) {
        console.log(`  Table ${table} does not exist, skipping`);
        continue;
      }
      
      // Check if table has tenant column (some might use tenant_id)
      const hasTenantColumn = await knex.raw(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = '${table}' 
        AND column_name IN ('tenant', 'tenant_id')
        LIMIT 1
      `);
      
      if (!hasTenantColumn.rows.length) {
        console.log(`  Table ${table} does not have tenant/tenant_id column, skipping`);
        continue;
      }
      
      const tenantColumn = hasTenantColumn.rows[0].column_name;
      console.log(`  Using tenant column: ${tenantColumn}`);
      
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

      // Step 1: Drop foreign key constraints
      console.log(`  Dropping foreign key constraints for ${table}...`);
      const fkConstraints = await knex.raw(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = '${table}'::regclass
        AND contype = 'f'
      `);
      
      for (const fk of fkConstraints.rows) {
        try {
          await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${fk.conname}`);
          console.log(`    ✓ Dropped FK: ${fk.conname}`);
        } catch (e) {
          console.log(`    - Could not drop FK ${fk.conname}: ${e.message}`);
        }
      }
      
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
      
      // Step 4: Special handling for company_billing_cycles
      if (table === 'company_billing_cycles') {
        // This table has persistent constraint issues - needs special handling
        console.log(`  Special handling for ${table}...`);
        
        // Drop ALL constraints including exclusion constraints
        console.log(`  Dropping all constraints for ${table}...`);
        const allConstraints = await knex.raw(`
          SELECT conname, contype
          FROM pg_constraint
          WHERE conrelid = '${table}'::regclass
          AND contype != 'p'  -- Keep primary key
        `);
        
        for (const constraint of allConstraints.rows) {
          try {
            await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${constraint.conname} CASCADE`);
            console.log(`    ✓ Dropped constraint: ${constraint.conname} (type: ${constraint.contype})`);
          } catch (e) {
            console.log(`    - Could not drop ${constraint.conname}: ${e.message}`);
          }
        }
        
        // Drop all indexes except primary key
        console.log(`  Dropping indexes for ${table}...`);
        const indexes = await knex.raw(`
          SELECT indexname
          FROM pg_indexes
          WHERE tablename = '${table}'
          AND indexname NOT LIKE '%_pkey'
        `);
        
        for (const idx of indexes.rows) {
          try {
            await knex.raw(`DROP INDEX IF EXISTS ${idx.indexname} CASCADE`);
            console.log(`    ✓ Dropped index: ${idx.indexname}`);
          } catch (e) {
            console.log(`    - Could not drop index ${idx.indexname}: ${e.message}`);
          }
        }
      }
      
      // Step 5: Distribute the table
      console.log(`  Distributing ${table}...`);
      // For service_types, use tenant_id instead of tenant
      const columnToUse = tenantColumn === 'tenant_id' ? 'tenant_id' : 'tenant';
      await knex.raw(`SELECT create_distributed_table('${table}', '${columnToUse}', colocate_with => 'tenants')`);
      console.log(`    ✓ Distributed ${table}`);
      
    } catch (error) {
      console.error(`  ✗ Failed to distribute ${table}: ${error.message}`);
      // Continue with other tables instead of throwing
      console.log(`  Continuing with remaining tables...`);
    }
  }
  
  // Process reference tables with special handling
  for (const table of referenceTables) {
    try {
      console.log(`\nProcessing ${table} as reference table...`);
      
      // Check if table exists
      const tableExists = await knex.schema.hasTable(table);
      if (!tableExists) {
        console.log(`  Table ${table} does not exist, skipping`);
        continue;
      }
      
      // Check if already a reference table
      const isReference = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = '${table}'::regclass
          AND partmethod = 'n'
        ) as is_reference
      `);
      
      if (isReference.rows[0].is_reference) {
        console.log(`  ${table} is already a reference table`);
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
        // Special handling for tables that should be reference but are currently distributed
        if (table === 'standard_statuses' || table === 'tenant_companies' || table === 'time_period_settings') {
          console.log(`  ${table} is currently distributed but should be reference, undistributing first...`);
          try {
            await knex.raw(`SELECT undistribute_table('${table}')`);
            console.log(`    ✓ Undistributed ${table}`);
          } catch (e) {
            console.log(`    - Could not undistribute ${table}: ${e.message}`);
            continue;
          }
        } else {
          console.log(`  ${table} is already distributed (not as reference), skipping`);
          continue;
        }
      }
      
      // For these tables, we need to drop foreign keys first before making them reference tables
      if (table === 'standard_statuses' || table === 'tenant_companies' || table === 'time_period_settings') {
        console.log(`  ${table} needs special handling - dropping constraints before making reference...`);
        
        // Drop all foreign key constraints
        console.log(`  Dropping foreign key constraints for ${table}...`);
        const fkConstraints = await knex.raw(`
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = '${table}'::regclass
          AND contype = 'f'
        `);
        
        for (const fk of fkConstraints.rows) {
          try {
            await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${fk.conname}`);
            console.log(`    ✓ Dropped FK: ${fk.conname}`);
          } catch (e) {
            console.log(`    - Could not drop FK ${fk.conname}: ${e.message}`);
          }
        }
        
        // Drop unique constraints that might cause issues
        console.log(`  Dropping unique constraints for ${table}...`);
        const uniqueConstraints = await knex.raw(`
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = '${table}'::regclass
          AND contype = 'u'
        `);
        
        for (const constraint of uniqueConstraints.rows) {
          try {
            await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${constraint.conname} CASCADE`);
            console.log(`    ✓ Dropped constraint: ${constraint.conname}`);
          } catch (e) {
            console.log(`    - Could not drop ${constraint.conname}: ${e.message}`);
          }
        }
        
        // Drop triggers
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
        
        // Now create as reference table
        console.log(`  Creating reference table ${table}...`);
        await knex.raw(`SELECT create_reference_table('${table}')`);
        console.log(`    ✓ Created reference table ${table}`);
      } else {
        // Regular reference table creation
        console.log(`  Creating reference table ${table}...`);
        await knex.raw(`SELECT create_reference_table('${table}')`);
        console.log(`    ✓ Created reference table ${table}`);
      }
      
    } catch (error) {
      console.error(`  ✗ Failed to process ${table}: ${error.message}`);
      console.log(`  Continuing with remaining tables...`);
    }
  }
  
  console.log('\n✓ Missing production tables distribution completed');
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

  console.log('Undistributing missing production tables...');
  
  // Reverse order for dependencies
  const distributedTables = [
    'user_notification_preferences',
    'tenant_telemetry_settings',
    'tenant_email_templates',
    'tenant_email_settings',
    'telemetry_consent_log',
    'email_sending_logs',
    'email_rate_limits',
    'email_processed_messages',
    'email_domains',
    'audit_logs',
    'api_keys',
    'vectors',
    'messages',
    'chats',
    'time_period_types',
    'tax_regions',
    'tax_rates',
    'tax_components',
    'task_checklist_items',
    'service_types',
    'plan_bundles',
    'document_content',
    'document_associations',
    'company_tax_rates',
    'company_plan_bundles',
    'company_billing_cycles',
    'client_billing'
  ];
  
  const referenceTables = [
    'tax_rate_thresholds',
    'tax_holidays',
    'standard_service_categories',
    'email_templates',
    'composite_tax_mappings',
    'time_period_settings',
    'tenant_companies',
    'standard_statuses'
  ];
  
  // Undistribute distributed tables
  for (const table of distributedTables) {
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
  
  // Undistribute reference tables
  for (const table of referenceTables) {
    try {
      const tableExists = await knex.schema.hasTable(table);
      if (!tableExists) continue;
      
      const isReference = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = '${table}'::regclass
          AND partmethod = 'n'
        ) as is_reference
      `);
      
      if (isReference.rows[0].is_reference) {
        await knex.raw(`SELECT undistribute_table('${table}')`);
        console.log(`  ✓ Undistributed reference table ${table}`);
      }
    } catch (error) {
      console.error(`  ✗ Failed to undistribute reference table ${table}: ${error.message}`);
    }
  }
};