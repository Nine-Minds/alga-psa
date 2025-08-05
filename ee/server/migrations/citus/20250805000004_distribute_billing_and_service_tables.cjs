/**
 * Distribute billing and service catalog related tables
 */

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

  console.log('Distributing billing and service tables...');
  
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

  // Tax configuration
  await distributeTable('tax_regions', 'tenant');
  await distributeTable('tax_rates', 'tenant');
  await distributeTable('tax_components', 'tenant');
  
  // Service catalog
  await distributeTable('service_categories', 'tenant');
  await distributeTable('service_types', 'tenant');
  await distributeTable('service_catalog', 'tenant');
  await distributeTable('service_rate_tiers', 'tenant');
  
  // Billing plans
  await distributeTable('billing_plans', 'tenant');
  await distributeTable('billing_plan_fixed_config', 'tenant');
  await distributeTable('plan_bundles', 'tenant');
  await distributeTable('bundle_billing_plans', 'tenant');
  await distributeTable('discounts', 'tenant');
  await distributeTable('plan_discounts', 'tenant');
  await distributeTable('default_billing_settings', 'tenant');
  
  // Plan services configuration
  await distributeTable('plan_services', 'tenant');
  await distributeTable('plan_service_configuration', 'tenant');
  await distributeTable('plan_service_bucket_config', 'tenant');
  await distributeTable('plan_service_fixed_config', 'tenant');
  await distributeTable('plan_service_hourly_config', 'tenant');
  await distributeTable('plan_service_hourly_configs', 'tenant');
  await distributeTable('plan_service_rate_tiers', 'tenant');
  await distributeTable('plan_service_usage_config', 'tenant');
  await distributeTable('user_type_rates', 'tenant');
  
  // Company billing relationships
  await distributeTable('company_billing_plans', 'tenant');
  await distributeTable('company_plan_bundles', 'tenant');
  await distributeTable('client_billing', 'tenant');
  await distributeTable('bucket_usage', 'tenant');
  
  // Invoice templates
  await distributeTable('invoice_templates', 'tenant');
  await distributeTable('template_sections', 'tenant');
  await distributeTable('layout_blocks', 'tenant');
  await distributeTable('conditional_display_rules', 'tenant');
  
  console.log('Billing and service tables distributed successfully');
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

  console.log('Undistributing billing and service tables...');
  
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
    'conditional_display_rules',
    'layout_blocks',
    'template_sections',
    'invoice_templates',
    'bucket_usage',
    'client_billing',
    'company_plan_bundles',
    'company_billing_plans',
    'user_type_rates',
    'plan_service_usage_config',
    'plan_service_rate_tiers',
    'plan_service_hourly_configs',
    'plan_service_hourly_config',
    'plan_service_fixed_config',
    'plan_service_bucket_config',
    'plan_service_configuration',
    'plan_services',
    'default_billing_settings',
    'plan_discounts',
    'discounts',
    'bundle_billing_plans',
    'plan_bundles',
    'billing_plan_fixed_config',
    'billing_plans',
    'service_rate_tiers',
    'service_catalog',
    'service_types',
    'service_categories',
    'tax_components',
    'tax_rates',
    'tax_regions'
  ];

  for (const table of tables) {
    await undistributeTable(table);
  }
};