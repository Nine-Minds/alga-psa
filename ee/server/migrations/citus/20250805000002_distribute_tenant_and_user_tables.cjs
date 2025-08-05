/**
 * Distribute the foundational tenant and user tables
 * These must be distributed first as many other tables depend on them
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

  console.log('Distributing tenant and user tables...');
  
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
      throw error;
    }
  }

  // Step 1: Distribute tenants table (root of the hierarchy)
  await distributeTable('tenants', 'tenant');
  
  // Step 2: Distribute users table (depends on tenants)
  await distributeTable('users', 'tenant');
  
  // Step 3: Distribute sessions (depends on users)
  await distributeTable('sessions', 'tenant');
  
  // Step 4: Distribute roles and permissions
  await distributeTable('roles', 'tenant');
  await distributeTable('permissions', 'tenant');
  await distributeTable('role_permissions', 'tenant');
  await distributeTable('user_roles', 'tenant');
  
  // Step 5: Distribute user preferences
  await distributeTable('user_preferences', 'tenant');
  await distributeTable('user_notification_preferences', 'tenant');
  
  console.log('Tenant and user tables distributed successfully');
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

  console.log('Undistributing tenant and user tables...');
  
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
  await undistributeTable('user_notification_preferences');
  await undistributeTable('user_preferences');
  await undistributeTable('user_roles');
  await undistributeTable('role_permissions');
  await undistributeTable('permissions');
  await undistributeTable('roles');
  await undistributeTable('sessions');
  await undistributeTable('users');
  await undistributeTable('tenants');
};