/**
 * Distribute remaining miscellaneous tables
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

  console.log('Distributing remaining miscellaneous tables...');
  
  const tables = [
    'payment_methods',
    'user_preferences',
    'approval_levels',
    'approval_thresholds',
    // 'client_billing', // Handled in migration 20
    'task_resources',
    'attribute_definitions',
    // 'chats', // Handled in migration 20
    // 'messages', // Handled in migration 20
    'company_locations',
    'company_tax_settings',
    // 'company_tax_rates', // Handled in migration 20
    // 'tax_rates', // Handled in migration 20
    // 'tax_components', // Handled in migration 20
    'custom_fields',
    'custom_task_types',
    'conditional_display_rules',
    'discounts',
    'document_block_content',
    // 'document_content', // Handled in migration 20
    'document_versions',
    // 'document_associations', // Handled in migration 20
    'external_files',
    'invoice_annotations',
    'invoice_time_entries',
    'invoice_item_details',
    'invoice_item_fixed_details',
    'invoice_usage_records',
    'job_details',
    'jobs',
    'layout_blocks',
    'policies',
    'project_status_mappings',
    'project_task_dependencies',
    'default_billing_settings',
    'company_billing_settings',
    'provider_events',
    'schedule_entry_assignees',
    'storage_configurations',
    'storage_providers',
    // 'task_checklist_items', // Handled in migration 20
    'template_sections',
    'time_sheet_comments',
    'transactions',
    'user_type_rates',
    // 'company_plan_bundles', // Handled in migration 20
    // 'plan_bundles', // Handled in migration 20
    'bundle_billing_plans',
    'tenant_external_entity_mappings',
    // 'service_types', // Handled in migration 20
    'service_rate_tiers',
    'plan_service_configuration',
    'plan_service_hourly_configs',
    'event_catalog',
    'workflow_form_definitions',
    'workflow_form_schemas',
    'workflow_registrations',
    'workflow_registration_versions',
    'workflow_event_attachments',
    'workflow_task_definitions',
    'workflow_template_categories',
    'workflow_templates',
    'vectors',
    'next_number'
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
  
  console.log('\n✓ Remaining miscellaneous tables distribution completed');
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

  console.log('Undistributing remaining miscellaneous tables...');
  
  // Reverse order for dependencies
  const tables = [
    'next_number',
    'vectors',
    'workflow_templates',
    'workflow_template_categories',
    'workflow_task_definitions',
    'workflow_event_attachments',
    'workflow_registration_versions',
    'workflow_registrations',
    'workflow_form_schemas',
    'workflow_form_definitions',
    'event_catalog',
    'plan_service_hourly_configs',
    'plan_service_configuration',
    'service_rate_tiers',
    // 'service_types', // Handled in migration 20
    'tenant_external_entity_mappings',
    'bundle_billing_plans',
    // 'plan_bundles', // Handled in migration 20
    // 'company_plan_bundles', // Handled in migration 20
    'user_type_rates',
    'transactions',
    'time_sheet_comments',
    'template_sections',
    // 'task_checklist_items', // Handled in migration 20
    'storage_providers',
    'storage_configurations',
    'schedule_entry_assignees',
    'provider_events',
    'company_billing_settings',
    'default_billing_settings',
    'project_task_dependencies',
    'project_status_mappings',
    'policies',
    'layout_blocks',
    'jobs',
    'job_details',
    'invoice_usage_records',
    'invoice_item_fixed_details',
    'invoice_item_details',
    'invoice_time_entries',
    'invoice_annotations',
    'external_files',
    // 'document_associations', // Handled in migration 20
    'document_versions',
    // 'document_content', // Handled in migration 20
    'document_block_content',
    'discounts',
    'conditional_display_rules',
    'custom_task_types',
    'custom_fields',
    // 'tax_components', // Handled in migration 20
    // 'tax_rates', // Handled in migration 20
    // 'company_tax_rates', // Handled in migration 20
    'company_tax_settings',
    'company_locations',
    // 'messages', // Handled in migration 20
    // 'chats', // Handled in migration 20
    'attribute_definitions',
    'task_resources',
    // 'client_billing', // Handled in migration 20
    'approval_thresholds',
    'approval_levels',
    'user_preferences',
    'payment_methods'
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