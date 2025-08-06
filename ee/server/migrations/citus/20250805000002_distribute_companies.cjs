/**
 * Distribute companies table - needed before contacts and users
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

  console.log('Distributing companies table...');
  
  try {
    // Check if table exists
    const tableExists = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'companies'
      ) as exists
    `);
    
    if (!tableExists.rows[0].exists) {
      console.log('  Companies table does not exist, skipping');
      return;
    }

    // Check if already distributed
    const isDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition 
        WHERE logicalrelid = 'companies'::regclass
      ) as distributed
    `);
    
    if (isDistributed.rows[0].distributed) {
      console.log('  Companies table already distributed');
      return;
    }
    
    // Distribute companies table
    await knex.raw(`SELECT create_distributed_table('companies', 'tenant')`);
    console.log('  ✓ Distributed companies table on column: tenant');
    
  } catch (error) {
    console.error(`  ✗ Failed to distribute companies: ${error.message}`);
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

  console.log('Undistributing companies table...');
  
  try {
    const isDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition 
        WHERE logicalrelid = 'companies'::regclass
      ) as distributed
    `);
    
    if (isDistributed.rows[0].distributed) {
      await knex.raw(`SELECT undistribute_table('companies')`);
      console.log('  ✓ Undistributed companies table');
    }
  } catch (error) {
    console.error(`  ✗ Failed to undistribute companies: ${error.message}`);
  }
};