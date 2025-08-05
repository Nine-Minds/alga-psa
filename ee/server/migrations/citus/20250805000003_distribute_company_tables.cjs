/**
 * Distribute company-related tables
 * These tables depend on tenants and users being distributed first
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

  console.log('Distributing company tables...');
  
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
      
      // Distribute the table with colocation to ensure JOINs work
      await knex.raw(`SELECT create_distributed_table('${tableName}', '${distributionColumn}', colocate_with => 'tenants')`);
      console.log(`  ✓ Distributed table: ${tableName} on column: ${distributionColumn}`);
      return true;
    } catch (error) {
      console.error(`  ✗ Failed to distribute table ${tableName}: ${error.message}`);
      throw error;
    }
  }

  // Companies and related tables
  await distributeTable('companies', 'tenant');
  await distributeTable('contacts', 'tenant');
  await distributeTable('company_locations', 'tenant');
  await distributeTable('company_billing_settings', 'tenant');
  await distributeTable('company_billing_cycles', 'tenant');
  await distributeTable('company_tax_settings', 'tenant');
  await distributeTable('company_tax_rates', 'tenant');
  await distributeTable('pending_registrations', 'tenant');
  await distributeTable('payment_methods', 'tenant');
  await distributeTable('inbound_ticket_defaults', 'tenant');
  
  console.log('Company tables distributed successfully');
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

  console.log('Undistributing company tables...');
  
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
  await undistributeTable('inbound_ticket_defaults');
  await undistributeTable('payment_methods');
  await undistributeTable('pending_registrations');
  await undistributeTable('company_tax_rates');
  await undistributeTable('company_tax_settings');
  await undistributeTable('company_billing_cycles');
  await undistributeTable('company_billing_settings');
  await undistributeTable('company_locations');
  await undistributeTable('contacts');
  await undistributeTable('companies');
};