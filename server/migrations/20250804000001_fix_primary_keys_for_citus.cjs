/**
 * Fix primary keys to include tenant column for Citus distribution
 * This migration must run before Citus migrations to ensure tables can be properly distributed
 */

exports.up = async function(knex) {
  console.log('Fixing primary keys to include tenant column for Citus distribution...');
  
  // List of tables that need their primary key fixed to include tenant
  const tablesToFix = [
    { table: 'company_billing_cycles', oldPK: 'company_billing_cycles_pkey', columns: ['tenant', 'company_id', 'cycle_id'] },
    { table: 'tax_rates', oldPK: 'tax_rates_pkey', columns: ['tenant', 'tax_rate_id'] },
    { table: 'document_associations', oldPK: 'document_associations_pkey', columns: ['tenant', 'association_id'] },
    { table: 'task_checklist_items', oldPK: 'task_checklist_items_pkey', columns: ['tenant', 'item_id'] },
    { table: 'company_plan_bundles', oldPK: 'company_plan_bundles_pkey', columns: ['tenant', 'company_bundle_id'] },
    { table: 'plan_bundles', oldPK: 'plan_bundles_pkey', columns: ['tenant', 'bundle_id'] },
    { table: 'service_types', oldPK: 'service_types_pkey', columns: ['tenant', 'service_type_id'] },
    { table: 'document_content', oldPK: 'document_content_pkey', columns: ['tenant', 'content_id'] },
    { table: 'tax_components', oldPK: 'tax_components_pkey', columns: ['tenant', 'tax_component_id'] },
    { table: 'credit_allocations', oldPK: 'credit_allocations_pkey', columns: ['tenant', 'allocation_id'] },
    { table: 'notification_logs', oldPK: 'notification_logs_pkey', columns: ['tenant', 'log_id'] },
    { table: 'notification_settings', oldPK: 'notification_settings_pkey', columns: ['tenant', 'setting_id'] },
    { table: 'gmail_processed_history', oldPK: 'gmail_processed_history_pkey', columns: ['tenant', 'history_id'] },
    { table: 'email_provider_health', oldPK: 'email_provider_health_pkey', columns: ['tenant', 'health_id'] },
    { table: 'asset_document_associations', oldPK: 'asset_document_associations_pkey', columns: ['tenant', 'association_id'] },
    { table: 'asset_maintenance_history', oldPK: 'asset_maintenance_history_pkey', columns: ['tenant', 'history_id'] },
    { table: 'asset_maintenance_notifications', oldPK: 'asset_maintenance_notifications_pkey', columns: ['tenant', 'notification_id'] },
    { table: 'asset_service_history', oldPK: 'asset_service_history_pkey', columns: ['tenant', 'history_id'] },
    { table: 'asset_ticket_associations', oldPK: 'asset_ticket_associations_pkey', columns: ['tenant', 'association_id'] },
    { table: 'credit_reconciliation_reports', oldPK: 'credit_reconciliation_reports_pkey', columns: ['tenant', 'report_id'] },
    { table: 'credit_tracking', oldPK: 'credit_tracking_pkey', columns: ['tenant', 'tracking_id'] }
  ];
  
  for (const { table, oldPK, columns } of tablesToFix) {
    try {
      // Check if table exists
      const tableExists = await knex.schema.hasTable(table);
      if (!tableExists) {
        console.log(`  Table ${table} does not exist, skipping`);
        continue;
      }
      
      // Check if tenant column exists
      const hasTenant = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = ? AND column_name = 'tenant'
        ) as has_tenant
      `, [table]);
      
      if (!hasTenant.rows[0].has_tenant) {
        console.log(`  Table ${table} does not have tenant column, skipping`);
        continue;
      }
      
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
        continue;
      }
      
      const pkColumns = currentPK.rows[0].columns;
      if (pkColumns.includes('tenant')) {
        console.log(`  Table ${table} already has tenant in primary key, skipping`);
        continue;
      }
      
      console.log(`  Fixing primary key for ${table}...`);
      
      // Drop the old primary key
      await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${oldPK}`);
      console.log(`    ✓ Dropped old primary key ${oldPK}`);
      
      // Create new primary key with tenant included
      const columnList = columns.join(', ');
      await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${oldPK} PRIMARY KEY (${columnList})`);
      console.log(`    ✓ Created new primary key with columns: ${columnList}`);
      
    } catch (error) {
      console.error(`  ✗ Failed to fix primary key for ${table}: ${error.message}`);
      // Continue with other tables
    }
  }
  
  console.log('Primary key fixes completed');
};

exports.down = async function(knex) {
  console.log('Reverting primary key changes...');
  
  // Revert primary keys to exclude tenant (original state)
  const tablesToRevert = [
    { table: 'company_billing_cycles', pk: 'company_billing_cycles_pkey', columns: ['cycle_id'] },
    { table: 'tax_rates', pk: 'tax_rates_pkey', columns: ['tax_rate_id'] },
    { table: 'document_associations', pk: 'document_associations_pkey', columns: ['association_id'] },
    { table: 'task_checklist_items', pk: 'task_checklist_items_pkey', columns: ['item_id'] },
    { table: 'company_plan_bundles', pk: 'company_plan_bundles_pkey', columns: ['company_bundle_id'] },
    { table: 'plan_bundles', pk: 'plan_bundles_pkey', columns: ['bundle_id'] },
    { table: 'service_types', pk: 'service_types_pkey', columns: ['service_type_id'] },
    { table: 'document_content', pk: 'document_content_pkey', columns: ['content_id'] },
    { table: 'tax_components', pk: 'tax_components_pkey', columns: ['tax_component_id'] },
    { table: 'credit_allocations', pk: 'credit_allocations_pkey', columns: ['allocation_id'] },
    { table: 'notification_logs', pk: 'notification_logs_pkey', columns: ['log_id'] },
    { table: 'notification_settings', pk: 'notification_settings_pkey', columns: ['setting_id'] },
    { table: 'gmail_processed_history', pk: 'gmail_processed_history_pkey', columns: ['history_id'] },
    { table: 'email_provider_health', pk: 'email_provider_health_pkey', columns: ['health_id'] },
    { table: 'asset_document_associations', pk: 'asset_document_associations_pkey', columns: ['association_id'] },
    { table: 'asset_maintenance_history', pk: 'asset_maintenance_history_pkey', columns: ['history_id'] },
    { table: 'asset_maintenance_notifications', pk: 'asset_maintenance_notifications_pkey', columns: ['notification_id'] },
    { table: 'asset_service_history', pk: 'asset_service_history_pkey', columns: ['history_id'] },
    { table: 'asset_ticket_associations', pk: 'asset_ticket_associations_pkey', columns: ['association_id'] },
    { table: 'credit_reconciliation_reports', pk: 'credit_reconciliation_reports_pkey', columns: ['report_id'] },
    { table: 'credit_tracking', pk: 'credit_tracking_pkey', columns: ['tracking_id'] }
  ];
  
  for (const { table, pk, columns } of tablesToRevert) {
    try {
      const tableExists = await knex.schema.hasTable(table);
      if (!tableExists) continue;
      
      await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${pk}`);
      const columnList = columns.join(', ');
      await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${pk} PRIMARY KEY (${columnList})`);
      console.log(`  ✓ Reverted primary key for ${table}`);
      
    } catch (error) {
      console.error(`  ✗ Failed to revert primary key for ${table}: ${error.message}`);
    }
  }
};