/**
 * Distribute basic tables that only depend on tenants
 * Complex tables with circular dependencies will be handled later
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

  console.log('Distributing basic tables that only depend on tenants...');
  
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
      
      // Distribute the table
      await knex.raw(`SELECT create_distributed_table('${tableName}', '${distributionColumn}')`);
      console.log(`  ✓ Distributed table: ${tableName} on column: ${distributionColumn}`);
      return true;
    } catch (error) {
      console.error(`  ✗ Failed to distribute table ${tableName}: ${error.message}`);
      // Don't throw - continue with other tables
      return false;
    }
  }

  // Distribute tables that only have FK to tenants (no other dependencies)
  const basicTables = [
    'roles',
    'permissions', 
    'role_permissions',
    'tenant_settings',
    'telemetry_settings',
    'credit_accounts',
    'credit_allocations',
    'credits',
    'credit_transactions'
  ];

  for (const table of basicTables) {
    await distributeTable(table);
  }
  
  console.log('Basic tables distribution completed');
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

  console.log('Undistributing basic tables...');
  
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
      }
      return true;
    } catch (error) {
      console.error(`  ✗ Failed to undistribute table ${tableName}: ${error.message}`);
      return false;
    }
  }

  // Undistribute in reverse order
  const basicTables = [
    'credit_transactions',
    'credits',
    'credit_allocations',
    'credit_accounts',
    'telemetry_settings',
    'tenant_settings',
    'role_permissions',
    'permissions',
    'roles'
  ];

  for (const table of basicTables) {
    await undistributeTable(table);
  }
};