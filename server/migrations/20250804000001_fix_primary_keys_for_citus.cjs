/**
 * Fix primary keys to include tenant column for Citus distribution
 * This migration must run before Citus migrations to ensure tables can be properly distributed
 */

exports.config = { transaction: false };

exports.up = async function(knex) {
  console.log('Checking if Citus is enabled...');
  
  // Check if Citus is enabled by looking for the citus extension
  const citusCheck = await knex.raw(`
    SELECT 1
    FROM pg_extension
    WHERE extname = 'citus'
  `);
  
  if (!citusCheck.rows.length) {
    console.log('Citus extension not found, skipping primary key fixes');
    return;
  }
  
  console.log('Citus detected, fixing primary keys to include tenant column for distribution...');
  
  // List of tables that need their primary key fixed to include tenant
  // Note: These tables need to have their existing single-column PK replaced with composite (tenant, id)
  const tablesToFix = [
    { table: 'company_billing_cycles', oldPK: 'company_billing_cycles_pkey', idColumn: 'billing_cycle_id' },
    { table: 'tax_rates', oldPK: 'tax_rates_pkey', idColumn: 'tax_rate_id' },
    { table: 'document_associations', oldPK: 'document_associations_pkey', idColumn: 'association_id' },
    { table: 'task_checklist_items', oldPK: 'task_checklist_items_pkey', idColumn: 'checklist_item_id' },
    { table: 'company_plan_bundles', oldPK: 'company_plan_bundles_pkey', idColumn: 'company_bundle_id' },
    { table: 'plan_bundles', oldPK: 'plan_bundles_pkey', idColumn: 'bundle_id' },
    { table: 'service_types', oldPK: 'service_types_pkey', idColumn: 'id' },
    { table: 'document_content', oldPK: 'document_content_pkey', idColumn: 'id' },
    { table: 'tax_components', oldPK: 'tax_components_pkey', idColumn: 'tax_component_id' },
    { table: 'credit_allocations', oldPK: 'credit_allocations_pkey', idColumn: 'allocation_id' },
    { table: 'notification_logs', oldPK: 'notification_logs_pkey', idColumn: 'id' },
    { table: 'notification_settings', oldPK: 'notification_settings_pkey', idColumn: 'id' },
    { table: 'gmail_processed_history', oldPK: 'gmail_processed_history_pkey', idColumn: 'history_id' },
    { table: 'email_provider_health', oldPK: 'email_provider_health_pkey', idColumn: 'id' },
    { table: 'asset_document_associations', oldPK: 'asset_document_associations_pkey', idColumn: 'association_id' },
    { table: 'asset_maintenance_history', oldPK: 'asset_maintenance_history_pkey', idColumn: 'history_id' },
    { table: 'asset_maintenance_notifications', oldPK: 'asset_maintenance_notifications_pkey', idColumn: 'notification_id' },
    { table: 'asset_service_history', oldPK: 'asset_service_history_pkey', idColumn: 'history_id' },
    { table: 'asset_ticket_associations', oldPK: 'asset_ticket_associations_pkey', idColumn: 'association_id' },
    { table: 'credit_reconciliation_reports', oldPK: 'credit_reconciliation_reports_pkey', idColumn: 'report_id' },
    { table: 'credit_tracking', oldPK: 'credit_tracking_pkey', idColumn: 'credit_id' },
    // Additional tables that need primary key fixes
    { table: 'api_keys', oldPK: 'api_keys_pkey', idColumn: 'api_key_id' },
    { table: 'audit_logs', oldPK: 'audit_logs_pkey', idColumn: 'audit_id' },
    { table: 'email_domains', oldPK: 'email_domains_pkey', idColumn: 'id' },
    { table: 'email_rate_limits', oldPK: 'email_rate_limits_pkey', idColumn: 'id' },
    { table: 'email_sending_logs', oldPK: 'email_sending_logs_pkey', idColumn: 'id' },
    { table: 'telemetry_consent_log', oldPK: 'telemetry_consent_log_pkey', idColumn: 'id' },
    { table: 'tenant_email_settings', oldPK: 'tenant_email_settings_pkey', idColumn: 'id' },
    { table: 'tenant_email_templates', oldPK: 'tenant_email_templates_pkey', idColumn: 'id' },
    { table: 'user_notification_preferences', oldPK: 'user_notification_preferences_pkey', idColumn: 'id' },
    { table: 'email_templates', oldPK: 'email_templates_pkey', idColumn: 'id' }
  ];
  
  // Process each table independently to avoid transaction issues
  const processTable = async ({ table, oldPK, idColumn }) => {
    try {
      // Check if table exists
      const tableExists = await knex.schema.hasTable(table);
      if (!tableExists) {
        console.log(`  Table ${table} does not exist, skipping`);
        return;
      }
      
      // Check if tenant column exists (could be 'tenant' or 'tenant_id')
      const tenantColumnCheck = await knex.raw(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = ? 
        AND column_name IN ('tenant', 'tenant_id')
        LIMIT 1
      `, [table]);
      
      if (!tenantColumnCheck.rows.length) {
        console.log(`  Table ${table} does not have tenant/tenant_id column, skipping`);
        return;
      }
      
      const tenantColumn = tenantColumnCheck.rows[0].column_name;
      console.log(`  Using tenant column: ${tenantColumn}`);
      
      // Check current primary key
      const currentPK = await knex.raw(`
        SELECT constraint_name, array_agg(column_name ORDER BY ordinal_position) as columns
        FROM information_schema.key_column_usage
        WHERE table_name = ? 
        AND constraint_name IN (
          SELECT constraint_name 
          FROM information_schema.table_constraints 
          WHERE table_name = ? AND constraint_type = 'PRIMARY KEY'
        )
        GROUP BY constraint_name
      `, [table, table]);
      
      if (currentPK.rows.length === 0) {
        console.log(`  Table ${table} has no primary key, skipping`);
        return;
      }
      
      const pkColumns = currentPK.rows[0].columns;
      if (pkColumns.includes('tenant') || pkColumns.includes('tenant_id')) {
        console.log(`  Table ${table} already has tenant/tenant_id in primary key, skipping`);
        return;
      }
      
      console.log(`  Fixing primary key for ${table}...`);
      
      // Store foreign keys that reference this table's primary key
      const referencingFKs = await knex.raw(`
        SELECT 
          tc.table_name as referencing_table,
          tc.constraint_name,
          kcu.column_name as referencing_column,
          ccu.column_name as referenced_column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu 
          ON tc.constraint_name = ccu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_name = ?
      `, [table]);
      
      // Drop referencing foreign keys first
      for (const fk of referencingFKs.rows) {
        try {
          await knex.raw(`ALTER TABLE ${fk.referencing_table} DROP CONSTRAINT IF EXISTS ${fk.constraint_name}`);
          console.log(`    ✓ Dropped referencing FK: ${fk.referencing_table}.${fk.constraint_name}`);
        } catch (e) {
          console.log(`    - Could not drop FK ${fk.constraint_name}: ${e.message}`);
        }
      }
      
      // Drop the old primary key with CASCADE to handle any remaining dependencies
      await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${oldPK} CASCADE`);
      console.log(`    ✓ Dropped old primary key ${oldPK} with CASCADE`);
      
      // Create new primary key with tenant included
      await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${oldPK} PRIMARY KEY (${tenantColumn}, ${idColumn})`);
      console.log(`    ✓ Created new primary key with columns: ${tenantColumn}, ${idColumn}`);
      
    } catch (error) {
      console.error(`  ✗ Failed to fix primary key for ${table}: ${error.message}`);
      // Continue with other tables
    }
  };
  
  // Process each table
  for (const tableConfig of tablesToFix) {
    await processTable(tableConfig);
  }
  
  console.log('Primary key fixes completed');
};

exports.down = async function(knex) {
  console.log('Checking if Citus is enabled before reverting...');
  
  // Check if Citus is enabled by looking for the citus extension
  const citusCheck = await knex.raw(`
    SELECT 1
    FROM pg_extension
    WHERE extname = 'citus'
  `);
  
  if (!citusCheck.rows.length) {
    console.log('Citus extension not found, skipping primary key reversion');
    return;
  }
  
  console.log('Citus detected, reverting primary key changes...');
  
  // Revert primary keys to exclude tenant (original state)
  const tablesToRevert = [
    { table: 'company_billing_cycles', pk: 'company_billing_cycles_pkey', idColumn: 'billing_cycle_id' },
    { table: 'tax_rates', pk: 'tax_rates_pkey', idColumn: 'tax_rate_id' },
    { table: 'document_associations', pk: 'document_associations_pkey', idColumn: 'association_id' },
    { table: 'task_checklist_items', pk: 'task_checklist_items_pkey', idColumn: 'checklist_item_id' },
    { table: 'company_plan_bundles', pk: 'company_plan_bundles_pkey', idColumn: 'company_bundle_id' },
    { table: 'plan_bundles', pk: 'plan_bundles_pkey', idColumn: 'bundle_id' },
    { table: 'service_types', pk: 'service_types_pkey', idColumn: 'id' },
    { table: 'document_content', pk: 'document_content_pkey', idColumn: 'id' },
    { table: 'tax_components', pk: 'tax_components_pkey', idColumn: 'tax_component_id' },
    { table: 'credit_allocations', pk: 'credit_allocations_pkey', idColumn: 'allocation_id' },
    { table: 'notification_logs', pk: 'notification_logs_pkey', idColumn: 'id' },
    { table: 'notification_settings', pk: 'notification_settings_pkey', idColumn: 'id' },
    { table: 'gmail_processed_history', pk: 'gmail_processed_history_pkey', idColumn: 'history_id' },
    { table: 'email_provider_health', pk: 'email_provider_health_pkey', idColumn: 'id' },
    { table: 'asset_document_associations', pk: 'asset_document_associations_pkey', idColumn: 'association_id' },
    { table: 'asset_maintenance_history', pk: 'asset_maintenance_history_pkey', idColumn: 'history_id' },
    { table: 'asset_maintenance_notifications', pk: 'asset_maintenance_notifications_pkey', idColumn: 'notification_id' },
    { table: 'asset_service_history', pk: 'asset_service_history_pkey', idColumn: 'history_id' },
    { table: 'asset_ticket_associations', pk: 'asset_ticket_associations_pkey', idColumn: 'association_id' },
    { table: 'credit_reconciliation_reports', pk: 'credit_reconciliation_reports_pkey', idColumn: 'report_id' },
    { table: 'credit_tracking', pk: 'credit_tracking_pkey', idColumn: 'credit_id' },
    // Additional tables
    { table: 'api_keys', pk: 'api_keys_pkey', idColumn: 'api_key_id' },
    { table: 'audit_logs', pk: 'audit_logs_pkey', idColumn: 'audit_id' },
    { table: 'email_domains', pk: 'email_domains_pkey', idColumn: 'id' },
    { table: 'email_rate_limits', pk: 'email_rate_limits_pkey', idColumn: 'id' },
    { table: 'email_sending_logs', pk: 'email_sending_logs_pkey', idColumn: 'id' },
    { table: 'telemetry_consent_log', pk: 'telemetry_consent_log_pkey', idColumn: 'id' },
    { table: 'tenant_email_settings', pk: 'tenant_email_settings_pkey', idColumn: 'id' },
    { table: 'tenant_email_templates', pk: 'tenant_email_templates_pkey', idColumn: 'id' },
    { table: 'user_notification_preferences', pk: 'user_notification_preferences_pkey', idColumn: 'id' },
    { table: 'email_templates', pk: 'email_templates_pkey', idColumn: 'id' }
  ];
  
  for (const { table, pk, idColumn } of tablesToRevert) {
    try {
      const tableExists = await knex.schema.hasTable(table);
      if (!tableExists) continue;
      
      await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${pk} CASCADE`);
      await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${pk} PRIMARY KEY (${idColumn})`);
      console.log(`  ✓ Reverted primary key for ${table}`);
      
    } catch (error) {
      console.error(`  ✗ Failed to revert primary key for ${table}: ${error.message}`);
    }
  }
};