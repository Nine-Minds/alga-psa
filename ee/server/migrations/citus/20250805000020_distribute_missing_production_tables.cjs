/**
 * Distribute tables that are missing from testing but present in production
 * This migration addresses inconsistencies between production and testing environments
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
    'user_notification_preferences',
    'email_templates',  // Has foreign keys to distributed tables, must be distributed
    'password_reset_tokens'  // Added from recent migrations
  ];
  
  // Tables that should be reference tables (system-wide, no tenant)
  const referenceTables = [
    'standard_statuses',
    'tenant_companies',
    'time_period_settings',
    // Additional reference tables without tenant columns
    // 'composite_tax_mappings', // Can't be reference until tax_components is distributed
    // 'email_templates', // Moved to distributed - has FKs to distributed tables
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
      
      // Step 4: Special handling for tables with persistent constraint issues
      if (table === 'company_billing_cycles' || table === 'tax_components') {
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

      

      // Recreate foreign keys for this table

      console.log(`  Recreating foreign keys for ${table}...`);

      await recreateForeignKeys(knex, table, capturedFKs);
      
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
  
  // Recreate critical foreign keys between distributed tables
  console.log('\nRecreating foreign keys between distributed tables...');
  
  // Foreign keys for tax_components
  if (await knex.schema.hasTable('tax_components')) {
    try {
      // Check if tax_components is distributed
      const isDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = 'tax_components'::regclass
        ) as distributed
      `);
      
      if (isDistributed.rows[0].distributed) {
        // tax_components -> tax_rates
        await knex.raw(`
          ALTER TABLE tax_components 
          ADD CONSTRAINT tax_components_tax_rate_id_foreign 
          FOREIGN KEY (tenant, tax_rate_id) 
          REFERENCES tax_rates(tenant, tax_rate_id) 
          ON DELETE CASCADE
        `);
        console.log('  ✓ Recreated FK: tax_components -> tax_rates');
        
        // composite_tax_mappings -> tax_components (if composite_tax_mappings is distributed)
        const compMappingsDistributed = await knex.raw(`
          SELECT EXISTS (
            SELECT 1 FROM pg_dist_partition 
            WHERE logicalrelid = 'composite_tax_mappings'::regclass
          ) as distributed
        `);
        
        if (compMappingsDistributed.rows[0].distributed) {
          await knex.raw(`
            ALTER TABLE composite_tax_mappings 
            ADD CONSTRAINT composite_tax_mappings_tax_component_id_foreign 
            FOREIGN KEY (tax_component_id) 
            REFERENCES tax_components(tax_component_id) 
            ON DELETE CASCADE
          `);
          console.log('  ✓ Recreated FK: composite_tax_mappings -> tax_components');
        }
      }
    } catch (e) {
      console.log(`  - Could not recreate tax_components FKs: ${e.message}`);
    }
  }
  
  // Foreign keys for email tables
  // Note: These tables have their tenant_id column renamed to tenant by 20250804000000_standardize_email_tenant_columns.cjs
  const emailTableFKs = [
    { table: 'email_domains', fk: 'email_domains_tenant_foreign', column: 'tenant', ref_table: 'tenants', ref_column: 'tenant' },
    { table: 'email_rate_limits', fk: 'email_rate_limits_tenant_foreign', column: 'tenant', ref_table: 'tenants', ref_column: 'tenant' },
    { table: 'email_sending_logs', fk: 'email_sending_logs_tenant_foreign', column: 'tenant', ref_table: 'tenants', ref_column: 'tenant' },
    { table: 'tenant_email_settings', fk: 'tenant_email_settings_tenant_foreign', column: 'tenant', ref_table: 'tenants', ref_column: 'tenant' }
  ];
  
  for (const { table, fk, column, ref_table, ref_column } of emailTableFKs) {
    try {
      if (await knex.schema.hasTable(table)) {
        const isDistributed = await knex.raw(`
          SELECT EXISTS (
            SELECT 1 FROM pg_dist_partition 
            WHERE logicalrelid = '${table}'::regclass
          ) as distributed
        `);
        
        if (isDistributed.rows[0].distributed) {
          await knex.raw(`
            ALTER TABLE ${table} 
            ADD CONSTRAINT ${fk} 
            FOREIGN KEY (${column}) 
            REFERENCES ${ref_table}(${ref_column}) 
            ON DELETE CASCADE
          `);
          console.log(`  ✓ Recreated FK: ${table} -> ${ref_table}`);
        }
      }
    } catch (e) {
      console.log(`  - Could not recreate FK ${fk}: ${e.message}`);
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
    'email_templates',
    'password_reset_tokens',
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
    // 'email_templates', // Moved to distributed
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