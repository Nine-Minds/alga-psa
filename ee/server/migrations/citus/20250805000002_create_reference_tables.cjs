/**
 * Create reference tables for lookup/configuration data
 * This must run early to avoid foreign key dependency issues
 * Reference tables are small lookup tables that are replicated to all worker nodes
 */

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
  
  try {
    // List of reference tables that need to be created early
    // These are lookup/configuration tables that are shared across all tenants
    const referenceTables = [
      // Document-related tables (only truly shared ones)
      'shared_document_types',
      
      // Standard lookup tables
      'countries',
      'currencies',
      'invoice_templates',
      'standard_categories',
      'standard_channels',
      'standard_invoice_templates',
      'standard_priorities',
      'standard_service_types',
      'standard_statuses',
      'standard_task_types',
      
      // System configuration tables
      'system_email_templates',
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
      'time_period_settings',
      'verification_tokens',
      'workflow_event_mappings',
      'tenant_companies',
    ];
    
    for (const tableName of referenceTables) {
      // Check if table exists
      const tableExists = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = ?
        ) as exists
      `, [tableName]);
      
      if (tableExists.rows[0].exists) {
        // Check if already distributed
        const isDistributed = await knex.raw(`
          SELECT EXISTS (
            SELECT 1 FROM pg_dist_partition 
            WHERE logicalrelid = ?::regclass
          ) as distributed
        `, [tableName]);
        
        if (!isDistributed.rows[0].distributed) {
          try {
            await knex.raw(`SELECT create_reference_table('${tableName}')`);
            console.log(`  ✓ Created ${tableName} as reference table`);
          } catch (e) {
            console.log(`  - Could not create ${tableName} as reference table: ${e.message}`);
            // Don't throw - some tables might have dependencies we handle later
          }
        } else {
          console.log(`  - ${tableName} already distributed`);
        }
      } else {
        console.log(`  - ${tableName} does not exist, skipping`);
      }
    }
    
    console.log('  ✓ Reference tables setup complete');
    
  } catch (error) {
    console.error(`  ✗ Failed to create reference tables: ${error.message}`);
    throw error;
  }
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
      
      // Standard lookup tables
      'countries',
      'currencies',
      'invoice_templates',
      'standard_categories',
      'standard_channels',
      'standard_invoice_templates',
      'standard_priorities',
      'standard_service_types',
      'standard_statuses',
      'standard_task_types',
      
      // System configuration tables
      'system_email_templates',
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
      'time_period_settings',
      'verification_tokens',
      'workflow_event_mappings',
      'tenant_companies',
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