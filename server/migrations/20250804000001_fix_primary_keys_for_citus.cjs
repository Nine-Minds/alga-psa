/**
 * Fix primary keys to include tenant column for Citus distribution
 * This migration must run before Citus migrations to ensure tables can be properly distributed
 */

exports.up = async function(knex) {
  console.log('Fixing primary keys to include tenant column for Citus distribution...');
  
  // This migration is safe to run on non-Citus databases as well
  // It ensures primary keys include tenant for proper multi-tenancy
  
  // List of tables that need their primary key fixed to include tenant
  // Note: These tables need to have their existing single-column PK replaced with composite (tenant, id)
  const tablesToFix = [
    { table: 'company_billing_cycles', oldPK: 'company_billing_cycles_pkey', idColumn: 'billing_cycle_id' },
    { table: 'tax_rates', oldPK: 'tax_rates_pkey', idColumn: 'tax_rate_id' },
    { table: 'document_associations', oldPK: 'document_associations_pkey', idColumn: 'association_id' },
    { table: 'task_checklist_items', oldPK: 'task_checklist_items_pkey', idColumn: 'item_id' },
    { table: 'company_plan_bundles', oldPK: 'company_plan_bundles_pkey', idColumn: 'company_bundle_id' },
    { table: 'plan_bundles', oldPK: 'plan_bundles_pkey', idColumn: 'bundle_id' },
    { table: 'service_types', oldPK: 'service_types_pkey', idColumn: 'service_type_id' },
    { table: 'document_content', oldPK: 'document_content_pkey', idColumn: 'content_id' },
    { table: 'tax_components', oldPK: 'tax_components_pkey', idColumn: 'tax_component_id' },
    { table: 'credit_allocations', oldPK: 'credit_allocations_pkey', idColumn: 'allocation_id' },
    { table: 'notification_logs', oldPK: 'notification_logs_pkey', idColumn: 'log_id' },
    { table: 'notification_settings', oldPK: 'notification_settings_pkey', idColumn: 'setting_id' },
    { table: 'gmail_processed_history', oldPK: 'gmail_processed_history_pkey', idColumn: 'history_id' },
    { table: 'email_provider_health', oldPK: 'email_provider_health_pkey', idColumn: 'health_id' },
    { table: 'asset_document_associations', oldPK: 'asset_document_associations_pkey', idColumn: 'association_id' },
    { table: 'asset_maintenance_history', oldPK: 'asset_maintenance_history_pkey', idColumn: 'history_id' },
    { table: 'asset_maintenance_notifications', oldPK: 'asset_maintenance_notifications_pkey', idColumn: 'notification_id' },
    { table: 'asset_service_history', oldPK: 'asset_service_history_pkey', idColumn: 'history_id' },
    { table: 'asset_ticket_associations', oldPK: 'asset_ticket_associations_pkey', idColumn: 'association_id' },
    { table: 'credit_reconciliation_reports', oldPK: 'credit_reconciliation_reports_pkey', idColumn: 'report_id' },
    { table: 'credit_tracking', oldPK: 'credit_tracking_pkey', idColumn: 'tracking_id' }
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
      
      // Check if tenant column exists
      const hasTenant = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = ? AND column_name = 'tenant'
        ) as has_tenant
      `, [table]);
      
      if (!hasTenant.rows[0].has_tenant) {
        console.log(`  Table ${table} does not have tenant column, skipping`);
        return;
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
        return;
      }
      
      const pkColumns = currentPK.rows[0].columns;
      if (pkColumns.includes('tenant')) {
        console.log(`  Table ${table} already has tenant in primary key, skipping`);
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
          await knex.raw(`ALTER TABLE ${fk.referencing_table} DROP CONSTRAINT ${fk.constraint_name}`);
          console.log(`    ✓ Dropped referencing FK: ${fk.referencing_table}.${fk.constraint_name}`);
        } catch (e) {
          console.log(`    - Could not drop FK ${fk.constraint_name}: ${e.message}`);
        }
      }
      
      // Drop the old primary key with CASCADE to handle any remaining dependencies
      await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${oldPK} CASCADE`);
      console.log(`    ✓ Dropped old primary key ${oldPK} with CASCADE`);
      
      // Create new primary key with tenant included
      await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${oldPK} PRIMARY KEY (tenant, ${idColumn})`);
      console.log(`    ✓ Created new primary key with columns: tenant, ${idColumn}`);
      
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
  console.log('Reverting primary key changes...');
  
  // Revert primary keys to exclude tenant (original state)
  const tablesToRevert = [
    { table: 'company_billing_cycles', pk: 'company_billing_cycles_pkey', idColumn: 'billing_cycle_id' },
    { table: 'tax_rates', pk: 'tax_rates_pkey', idColumn: 'tax_rate_id' },
    { table: 'document_associations', pk: 'document_associations_pkey', idColumn: 'association_id' },
    { table: 'task_checklist_items', pk: 'task_checklist_items_pkey', idColumn: 'item_id' },
    { table: 'company_plan_bundles', pk: 'company_plan_bundles_pkey', idColumn: 'company_bundle_id' },
    { table: 'plan_bundles', pk: 'plan_bundles_pkey', idColumn: 'bundle_id' },
    { table: 'service_types', pk: 'service_types_pkey', idColumn: 'service_type_id' },
    { table: 'document_content', pk: 'document_content_pkey', idColumn: 'content_id' },
    { table: 'tax_components', pk: 'tax_components_pkey', idColumn: 'tax_component_id' },
    { table: 'credit_allocations', pk: 'credit_allocations_pkey', idColumn: 'allocation_id' },
    { table: 'notification_logs', pk: 'notification_logs_pkey', idColumn: 'log_id' },
    { table: 'notification_settings', pk: 'notification_settings_pkey', idColumn: 'setting_id' },
    { table: 'gmail_processed_history', pk: 'gmail_processed_history_pkey', idColumn: 'history_id' },
    { table: 'email_provider_health', pk: 'email_provider_health_pkey', idColumn: 'health_id' },
    { table: 'asset_document_associations', pk: 'asset_document_associations_pkey', idColumn: 'association_id' },
    { table: 'asset_maintenance_history', pk: 'asset_maintenance_history_pkey', idColumn: 'history_id' },
    { table: 'asset_maintenance_notifications', pk: 'asset_maintenance_notifications_pkey', idColumn: 'notification_id' },
    { table: 'asset_service_history', pk: 'asset_service_history_pkey', idColumn: 'history_id' },
    { table: 'asset_ticket_associations', pk: 'asset_ticket_associations_pkey', idColumn: 'association_id' },
    { table: 'credit_reconciliation_reports', pk: 'credit_reconciliation_reports_pkey', idColumn: 'report_id' },
    { table: 'credit_tracking', pk: 'credit_tracking_pkey', idColumn: 'tracking_id' }
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