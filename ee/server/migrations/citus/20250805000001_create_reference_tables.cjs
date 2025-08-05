/**
 * Create reference tables (replicated to all worker nodes)
 * Reference tables are small lookup tables that need to be available on all nodes for JOINs
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

  console.log('Creating reference tables (replicated across all nodes)...');
  
  // Reference tables from production (colocation group 48)
  const referenceTables = [
    'company_email_settings',
    'countries',
    'notification_categories', 
    'notification_subtypes',
    'shared_document_types',
    'standard_categories',
    'standard_channels',
    'standard_invoice_templates',
    'standard_priorities',
    'standard_service_types',
    'standard_statuses',
    'standard_task_types',
    'system_email_templates',
    'system_interaction_types',
    'system_workflow_event_attachments',
    'system_workflow_form_definitions',
    'system_workflow_registration_versions',
    'system_workflow_registrations',
    'system_workflow_task_definitions',
    'tenant_companies',
    'time_period_settings',
    'verification_tokens',
    'workflow_event_mappings'
  ];

  for (const table of referenceTables) {
    try {
      // Check if table exists
      const tableExists = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = ?
        ) as exists
      `, [table]);
      
      if (!tableExists.rows[0].exists) {
        console.log(`  Table ${table} does not exist, skipping`);
        continue;
      }

      // Check if already distributed
      const isDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = ?::regclass
        ) as distributed
      `, [table]);
      
      if (isDistributed.rows[0].distributed) {
        console.log(`  Table ${table} already distributed, skipping`);
        continue;
      }
      
      await knex.raw(`SELECT create_reference_table('${table}')`);
      console.log(`  ✓ Created reference table: ${table}`);
    } catch (error) {
      console.error(`  ✗ Failed to create reference table ${table}: ${error.message}`);
      // Continue with other tables
    }
  }
  
  console.log('Reference tables created successfully');
};

exports.down = async function(knex) {
  // Check if Citus is enabled
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);
  
  if (!citusEnabled.rows[0].enabled) {
    return;
  }

  console.log('Undistributing reference tables...');
  
  const referenceTables = [
    'company_email_settings',
    'countries',
    'notification_categories',
    'notification_subtypes',
    'shared_document_types',
    'standard_categories',
    'standard_channels',
    'standard_invoice_templates',
    'standard_priorities',
    'standard_service_types',
    'standard_statuses',
    'standard_task_types',
    'system_email_templates',
    'system_interaction_types',
    'system_workflow_event_attachments',
    'system_workflow_form_definitions',
    'system_workflow_registration_versions',
    'system_workflow_registrations',
    'system_workflow_task_definitions',
    'tenant_companies',
    'time_period_settings',
    'verification_tokens',
    'workflow_event_mappings'
  ];

  for (const table of referenceTables) {
    try {
      const isDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = ?::regclass
        ) as distributed
      `, [table]);
      
      if (isDistributed.rows[0].distributed) {
        await knex.raw(`SELECT undistribute_table('${table}')`);
        console.log(`  ✓ Undistributed table: ${table}`);
      }
    } catch (error) {
      console.error(`  ✗ Failed to undistribute table ${table}: ${error.message}`);
    }
  }
};