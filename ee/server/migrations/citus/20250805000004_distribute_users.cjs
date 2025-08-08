/**
 * Distribute users table and related tables
 * Contacts are now handled with companies in the previous migration
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

  console.log('Distributing users table and related tables...');
  
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
      console.log(`  ✓ Distributed table: ${tableName} on column: ${distributionColumn}`);
      return true;
    } catch (error) {
      console.error(`  ✗ Failed to distribute table ${tableName}: ${error.message}`);
      throw error;
    }
  }

  // Users is now distributed in the companies/contacts migration (0003) due to dependencies
  // await distributeTable('users');
  
  // Then tables that depend on users
  await distributeTable('sessions');
  await distributeTable('user_roles');
  await distributeTable('user_preferences');
  await distributeTable('user_notification_preferences');
  
  console.log('Users table and related tables distributed successfully');
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

  console.log('Undistributing users table and related tables...');
  
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
  await undistributeTable('user_notification_preferences');
  await undistributeTable('user_preferences');
  await undistributeTable('user_roles');
  await undistributeTable('sessions');
  // Users is undistributed in companies/contacts migration
  // await undistributeTable('users');
};