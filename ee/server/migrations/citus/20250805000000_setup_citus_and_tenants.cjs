/**
 * Enable Citus extension and distribute tenants table first
 * This is the foundation for all other distributed tables
 */
exports.config = { transaction: false };

exports.up = async function(knex) {
  console.log('Checking for Citus extension...');
  
  // Check if Citus extension exists
  const extensionExists = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_available_extensions 
      WHERE name = 'citus'
    ) as exists
  `);
  
  if (!extensionExists.rows[0].exists) {
    console.log('Citus extension not available, skipping');
    return;
  }

  // Enable Citus if not already enabled
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);
  
  if (!citusEnabled.rows[0].enabled) {
    console.log('Enabling Citus extension...');
    await knex.raw('CREATE EXTENSION IF NOT EXISTS citus');
    console.log('Citus extension enabled successfully');
  } else {
    console.log('Citus extension already enabled');
  }

  // Verify Citus is working
  const version = await knex.raw('SELECT citus_version()');
  console.log(`Citus ${version.rows[0].citus_version} enabled successfully`);

  // Check if tenants table exists
  const tenantsExists = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'tenants'
    ) as exists
  `);
  
  if (!tenantsExists.rows[0].exists) {
    console.log('Tenants table does not exist yet, will be created by regular migrations');
    return;
  }

  // Check if already distributed
  const isDistributed = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition 
      WHERE logicalrelid = 'tenants'::regclass
    ) as distributed
  `);
  
  if (isDistributed.rows[0].distributed) {
    console.log('Tenants table already distributed');
    return;
  }

  // Distribute the tenants table - this is the root of our distribution hierarchy
  console.log('Distributing tenants table...');
  try {
    await knex.raw(`SELECT create_distributed_table('tenants', 'tenant')`);
    console.log('✓ Distributed tenants table on column: tenant');
  } catch (error) {
    console.error(`Failed to distribute tenants table: ${error.message}`);
    throw error;
  }
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

  console.log('Undistributing tenants table...');
  
  try {
    // Check if table is distributed
    const isDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition 
        WHERE logicalrelid = 'tenants'::regclass
      ) as distributed
    `);
    
    if (isDistributed.rows[0].distributed) {
      // Undistribute the table
      await knex.raw(`SELECT undistribute_table('tenants')`);
      console.log('✓ Undistributed tenants table');
    }
  } catch (error) {
    console.error(`Failed to undistribute tenants: ${error.message}`);
  }
  
  // Note: We don't drop the Citus extension as other databases might be using it
  console.log('Citus extension cleanup completed (extension not dropped)');
};