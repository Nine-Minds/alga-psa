/**
 * Create reference tables for lookup/configuration data
 * This must run early to avoid foreign key dependency issues
 * Reference tables are small lookup tables that are replicated to all worker nodes
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
    console.log('Citus not enabled, skipping reference table creation');
    return;
  }

  console.log('Creating reference tables for lookup/configuration data...');
  
  // List of reference tables that need to be created early
  // These are lookup/configuration tables that are shared across all tenants
  // Ordered to handle dependencies (notification tables first, then system tables that reference them)
  const referenceTables = [
    // Notification tables - BOTH are needed as a pair
    'notification_categories',  // Must come first
    'notification_subtypes',     // Depends on notification_categories
    
    // Document-related tables (only truly shared ones)
    'shared_document_types',
    
    // Standard lookup tables (without tenant columns)
    'countries',
    'standard_categories',
    'standard_channels',
    'standard_invoice_templates',
    'standard_priorities',
    'standard_service_types',
    // 'standard_statuses', - Has tenant column and FKs to distributed tables, must remain distributed
    'standard_task_types',
    
    // System workflow tables - order matters for dependencies
    'system_workflow_registrations',        // Must come first
    'system_workflow_registration_versions', // Depends on registrations
    'system_workflow_event_attachments',    // Depends on registrations
    'system_workflow_form_definitions',
    'system_workflow_task_definitions',
    
    // System configuration tables
    'system_email_templates',  // Now after notification tables
    // 'system_event_catalog', - Has triggers, cannot be distributed with Citus
    'system_interaction_types',
    
    // Other configuration tables
    'workflow_event_mappings',
    // 'time_period_settings', - Has tenant column, moved to distributed tables
    // 'verification_tokens', - Has tenant column, moved to distributed tables
    // 'tenant_companies', - Has tenant_id column, moved to distributed tables
  ];
  let successCount = 0;
  let failedTables = [];
  
  for (const tableName of referenceTables) {
    try {
      // Check if table exists
      const tableExists = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = ?
        ) as exists
      `, [tableName]);
      
      if (!tableExists.rows[0].exists) {
        console.log(`  - ${tableName} does not exist, skipping`);
        continue;
      }

      // Check if already distributed
      const isDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = ?::regclass
        ) as distributed
      `, [tableName]);
      
      if (isDistributed.rows[0].distributed) {
        console.log(`  - ${tableName} already distributed`);
        continue;
      }
      
      // Try to create as reference table
      await knex.raw(`SELECT create_reference_table('${tableName}')`);
      console.log(`  ✓ Created ${tableName} as reference table`);
      successCount++;
      
    } catch (e) {
      console.log(`  - Could not create ${tableName} as reference table: ${e.message}`);
      failedTables.push({table: tableName, error: e.message});
      // Continue with next table instead of aborting
    }
  }
  
  // Try failed tables again in case dependencies are now resolved
  if (failedTables.length > 0) {
    console.log('\n  Retrying failed tables...');
    for (const {table: tableName} of failedTables) {
      try {
        // Check if still not distributed
        const isDistributed = await knex.raw(`
          SELECT EXISTS (
            SELECT 1 FROM pg_dist_partition 
            WHERE logicalrelid = ?::regclass
          ) as distributed
        `, [tableName]);
        
        if (!isDistributed.rows[0].distributed) {
          await knex.raw(`SELECT create_reference_table('${tableName}')`);
          console.log(`  ✓ Created ${tableName} as reference table (on retry)`);
          successCount++;
        }
      } catch (e) {
        console.log(`  - Still could not create ${tableName} as reference table: ${e.message}`);
      }
    }
  }
  
  console.log(`\n  ✓ Reference tables setup complete (${successCount} tables created)`);
};

exports.down = async function(knex) {
  // Check if Citus is enabled
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);
  
  if (!citusEnabled.rows[0].enabled) {
    console.log('Citus not enabled, nothing to undo');
    return;
  }

  console.log('Undistributing reference tables...');
  
  try {
    const tablesToUndistribute = [
      // Document-related tables (only truly shared ones)
      'shared_document_types',
      
      // Standard lookup tables (without tenant columns)
      'countries',
      // 'invoice_templates', - Has tenant column, moved to distributed tables
      'standard_categories',
      'standard_channels',
      'standard_invoice_templates',
      'standard_priorities',
      'standard_service_types',
      // 'standard_statuses', - Has tenant column and FKs to distributed tables, must remain distributed
      'standard_task_types',
      
      // System configuration tables
      'system_email_templates',
      // 'system_event_catalog', - Has triggers, cannot be distributed with Citus
      'system_interaction_types',
      'system_workflow_event_attachments',
      'system_workflow_form_definitions',
      'system_workflow_registration_versions',
      'system_workflow_registrations',
      'system_workflow_task_definitions',
      
      // Notification tables
      'notification_categories',
      'notification_subtypes',
      
      // Other configuration tables
      // 'time_period_settings', - Has tenant column, moved to distributed tables
      // 'verification_tokens', - Has tenant column, moved to distributed tables
      'workflow_event_mappings',
      // 'tenant_companies', - Has tenant_id column, moved to distributed tables
    ];
    
    for (const tableName of tablesToUndistribute) {
      // Check if table exists and is distributed
      const tableExists = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = ?
        ) as exists
      `, [tableName]);
      
      if (tableExists.rows[0].exists) {
        const isDistributed = await knex.raw(`
          SELECT EXISTS (
            SELECT 1 FROM pg_dist_partition 
            WHERE logicalrelid = ?::regclass
          ) as distributed
        `, [tableName]);
        
        if (isDistributed.rows[0].distributed) {
          try {
            await knex.raw(`SELECT undistribute_table('${tableName}')`);
            console.log(`  ✓ Undistributed ${tableName} table`);
          } catch (e) {
            console.log(`  - Could not undistribute ${tableName}: ${e.message}`);
          }
        }
      }
    }
    
  } catch (error) {
    console.error(`  ✗ Failed to undistribute: ${error.message}`);
  }
};
