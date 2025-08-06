/**
 * Enable Citus extension for distributed PostgreSQL
 * This must be run after RLS policies are removed (20250523152638)
 */

exports.up = async function(knex) {
  console.log('Checking for Citus extension availability...');
  
  // Check if Citus is available
  const citusAvailable = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_available_extensions 
      WHERE name = 'citus'
    ) as available
  `);
  
  if (!citusAvailable.rows[0].available) {
    console.log('Citus extension not available, skipping Citus setup');
    return;
  }
  
  // Enable Citus extension
  await knex.raw('CREATE EXTENSION IF NOT EXISTS citus');
  
  // Verify Citus is enabled
  const citusEnabled = await knex.raw(`
    SELECT extname, extversion 
    FROM pg_extension 
    WHERE extname = 'citus'
  `);
  
  if (citusEnabled.rows.length > 0) {
    console.log(`Citus ${citusEnabled.rows[0].extversion} enabled successfully`);
  }
  
  // Set default shard count for better distribution
  await knex.raw("SET citus.shard_count = 32");
  
  // Set default replication factor (1 for development, higher for production)
  await knex.raw("SET citus.shard_replication_factor = 1");
  
  console.log('Citus extension setup completed');
};

exports.down = async function(knex) {
  console.log('Disabling Citus extension...');
  
  // Note: This will fail if any distributed tables exist
  // All distributed tables must be undistributed first
  await knex.raw('DROP EXTENSION IF EXISTS citus CASCADE');
  
  console.log('Citus extension disabled');
};