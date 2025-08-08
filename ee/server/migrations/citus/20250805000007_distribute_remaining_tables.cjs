/**
 * Distribute remaining tables including invoicing, assets, documents, workflows, etc.
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

  console.log('Distributing remaining tables...');
  
  // Helper function to safely distribute a table
  async function distributeTable(tableName, distributionColumn = 'tenant') {
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
        console.log(`  Table ${tableName} does not exist, skipping`);
        return false;
      }

      // Check if already distributed
      const isDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = ?::regclass
        ) as distributed
      `, [tableName]);
      
      if (isDistributed.rows[0].distributed) {
        console.log(`  Table ${tableName} already distributed, skipping`);
        return true;
      }
      
      // Distribute the table with colocation
      await knex.raw(`SELECT create_distributed_table('${tableName}', '${distributionColumn}', colocate_with => 'tenants')`);
      console.log(`  ✓ Distributed table: ${tableName}`);
      return true;
    } catch (error) {
      console.error(`  ✗ Failed to distribute table ${tableName}: ${error.message}`);
      throw error;
    }
  }

  // Invoicing and transactions
  await distributeTable('invoices', 'tenant');
  await distributeTable('invoice_items', 'tenant');
  await distributeTable('invoice_item_details', 'tenant');
  await distributeTable('invoice_item_fixed_details', 'tenant');
  await distributeTable('invoice_time_entries', 'tenant');
  await distributeTable('invoice_usage_records', 'tenant');
  await distributeTable('invoice_annotations', 'tenant');
  await distributeTable('transactions', 'tenant');
  await distributeTable('credit_tracking', 'tenant');
  await distributeTable('credit_allocations', 'tenant');
  await distributeTable('credit_reconciliation_reports', 'tenant');
  await distributeTable('usage_tracking', 'tenant');
  
  // Assets
  await distributeTable('assets', 'tenant');
  await distributeTable('asset_associations', 'tenant');
  await distributeTable('asset_relationships', 'tenant');
  await distributeTable('asset_history', 'tenant');
  await distributeTable('asset_maintenance_schedules', 'tenant');
  await distributeTable('asset_maintenance_history', 'tenant');
  await distributeTable('asset_maintenance_notifications', 'tenant');
  await distributeTable('asset_ticket_associations', 'tenant');
  await distributeTable('asset_document_associations', 'tenant');
  await distributeTable('asset_service_history', 'tenant');
  await distributeTable('mobile_device_assets', 'tenant');
  await distributeTable('network_device_assets', 'tenant');
  await distributeTable('printer_assets', 'tenant');
  await distributeTable('server_assets', 'tenant');
  await distributeTable('workstation_assets', 'tenant');
  
  // Documents
  await distributeTable('documents', 'tenant');
  await distributeTable('document_types', 'tenant');
  await distributeTable('document_versions', 'tenant');
  await distributeTable('document_content', 'tenant');
  await distributeTable('document_block_content', 'tenant');
  await distributeTable('document_associations', 'tenant');
  await distributeTable('external_files', 'tenant');
  
  // Storage
  await distributeTable('storage_providers', 'tenant');
  await distributeTable('storage_configurations', 'tenant');
  await distributeTable('provider_events', 'tenant');
  
  // Workflows
  await distributeTable('workflow_templates', 'tenant');
  await distributeTable('workflow_template_categories', 'tenant');
  await distributeTable('workflow_registrations', 'tenant');
  await distributeTable('workflow_registration_versions', 'tenant');
  await distributeTable('workflow_form_definitions', 'tenant');
  await distributeTable('workflow_form_schemas', 'tenant');
  await distributeTable('workflow_task_definitions', 'tenant');
  await distributeTable('workflow_executions', 'tenant');
  await distributeTable('workflow_tasks', 'tenant');
  await distributeTable('workflow_task_history', 'tenant');
  await distributeTable('workflow_action_results', 'tenant');
  await distributeTable('workflow_action_dependencies', 'tenant');
  await distributeTable('workflow_snapshots', 'tenant');
  await distributeTable('workflow_sync_points', 'tenant');
  await distributeTable('workflow_timers', 'tenant');
  await distributeTable('workflow_triggers', 'tenant');
  await distributeTable('workflow_events', 'tenant');
  await distributeTable('workflow_event_processing', 'tenant');
  await distributeTable('workflow_event_attachments', 'tenant');
  
  // Notifications
  await distributeTable('notification_settings', 'tenant');
  await distributeTable('notification_logs', 'tenant');
  
  // Extensions
  await distributeTable('extensions', 'tenant');
  await distributeTable('extension_settings', 'tenant');
  await distributeTable('extension_storage', 'tenant');
  
  // Email
  await distributeTable('email_providers', 'tenant');
  await distributeTable('email_provider_configs', 'tenant');
  await distributeTable('email_processed_messages', 'tenant');
  await distributeTable('gmail_processed_history', 'tenant');
  await distributeTable('google_email_provider_config', 'tenant');
  await distributeTable('microsoft_email_provider_config', 'tenant');
  await distributeTable('tenant_email_templates', 'tenant');
  
  // Tags
  await distributeTable('tag_definitions', 'tenant');
  await distributeTable('tag_mappings', 'tenant');
  
  // Policies and approvals
  await distributeTable('policies', 'tenant');
  await distributeTable('approval_levels', 'tenant');
  await distributeTable('approval_thresholds', 'tenant');
  
  // Misc
  await distributeTable('custom_fields', 'tenant');
  await distributeTable('custom_task_types', 'tenant');
  await distributeTable('attribute_definitions', 'tenant');
  await distributeTable('event_catalog', 'tenant');
  await distributeTable('tenant_settings', 'tenant');
  await distributeTable('tenant_external_entity_mappings', 'tenant');
  await distributeTable('next_number', 'tenant');
  await distributeTable('api_keys', 'tenant');
  
  // Telemetry (if tables exist)
  await distributeTable('tenant_telemetry_settings', 'tenant');
  await distributeTable('telemetry_consent_log', 'tenant');
  
  // Audit logs (if exists)
  await distributeTable('audit_logs', 'tenant');
  
  // Email domain tables (now standardized to use tenant column)
  await distributeTable('email_domains', 'tenant');
  await distributeTable('email_provider_health', 'tenant');
  await distributeTable('email_rate_limits', 'tenant');
  await distributeTable('email_sending_logs', 'tenant');
  await distributeTable('email_templates', 'tenant');
  await distributeTable('tenant_email_settings', 'tenant');
  
  // Tables with tenant columns that were incorrectly classified as reference tables
  // 'standard_statuses' is now a reference table (tenant column removed in base migration)
  await distributeTable('time_period_settings', 'tenant');
  await distributeTable('verification_tokens', 'tenant');
  await distributeTable('tenant_companies', 'tenant');
  
  console.log('Remaining tables distributed successfully');
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

  console.log('Undistributing remaining tables...');
  
  // Helper function to safely undistribute a table
  async function undistributeTable(tableName) {
    try {
      const isDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = ?::regclass
        ) as distributed
      `, [tableName]);
      
      if (isDistributed.rows[0].distributed) {
        await knex.raw(`SELECT undistribute_table('${tableName}')`);
        console.log(`  ✓ Undistributed table: ${tableName}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`  ✗ Failed to undistribute table ${tableName}: ${error.message}`);
      return false;
    }
  }

  // Undistribute in reverse order
  const tables = [
    // Tables with tenant columns that were incorrectly classified as reference tables
    'tenant_companies',
    'verification_tokens',
    'time_period_settings',
    'standard_statuses',
    'tenant_email_settings',
    'email_templates',
    'email_sending_logs',
    'email_rate_limits',
    'email_provider_health',
    'email_domains',
    'audit_logs',
    'telemetry_consent_log',
    'tenant_telemetry_settings',
    'api_keys',
    'next_number',
    'tenant_external_entity_mappings',
    'tenant_settings',
    'event_catalog',
    'attribute_definitions',
    'custom_task_types',
    'custom_fields',
    'approval_thresholds',
    'approval_levels',
    'policies',
    'tag_mappings',
    'tag_definitions',
    'tenant_email_templates',
    'microsoft_email_provider_config',
    'google_email_provider_config',
    'gmail_processed_history',
    'email_processed_messages',
    'email_provider_configs',
    'email_providers',
    'extension_storage',
    'extension_settings',
    'extensions',
    'notification_logs',
    'notification_settings',
    'workflow_event_attachments',
    'workflow_event_processing',
    'workflow_events',
    'workflow_triggers',
    'workflow_timers',
    'workflow_sync_points',
    'workflow_snapshots',
    'workflow_action_dependencies',
    'workflow_action_results',
    'workflow_task_history',
    'workflow_tasks',
    'workflow_executions',
    'workflow_task_definitions',
    'workflow_form_schemas',
    'workflow_form_definitions',
    'workflow_registration_versions',
    'workflow_registrations',
    'workflow_template_categories',
    'workflow_templates',
    'provider_events',
    'storage_configurations',
    'storage_providers',
    'external_files',
    'document_associations',
    'document_block_content',
    'document_content',
    'document_versions',
    'document_types',
    'documents',
    'workstation_assets',
    'server_assets',
    'printer_assets',
    'network_device_assets',
    'mobile_device_assets',
    'asset_service_history',
    'asset_document_associations',
    'asset_ticket_associations',
    'asset_maintenance_notifications',
    'asset_maintenance_history',
    'asset_maintenance_schedules',
    'asset_history',
    'asset_relationships',
    'asset_associations',
    'assets',
    'usage_tracking',
    'credit_reconciliation_reports',
    'credit_allocations',
    'credit_tracking',
    'transactions',
    'invoice_annotations',
    'invoice_usage_records',
    'invoice_time_entries',
    'invoice_item_fixed_details',
    'invoice_item_details',
    'invoice_items',
    'invoices'
  ];

  for (const table of tables) {
    await undistributeTable(table);
  }
};