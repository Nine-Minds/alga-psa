/**
 * Distribute contacts table
 * Companies must be distributed first (contacts has FK to companies)
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

  console.log('Distributing contacts table...');
  
  try {
    // Check if already distributed
    const isDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition 
        WHERE logicalrelid = 'contacts'::regclass
      ) as distributed
    `);
    
    if (isDistributed.rows[0].distributed) {
      console.log('  Contacts table already distributed');
      return;
    }

    // Step 1: Capture and drop foreign key constraints
    console.log('  Step 1: Capturing and dropping foreign key constraints...');
    const capturedFKs = await dropAndCaptureForeignKeys(knex, 'contacts');
    
    // Step 2: Drop unique constraints that don't include tenant
    console.log('  Step 2: Dropping unique constraints...');
    const uniqueConstraints = await knex.raw(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'contacts'::regclass
      AND contype = 'u'
    `);
    
    for (const constraint of uniqueConstraints.rows) {
      try {
        await knex.raw(`ALTER TABLE contacts DROP CONSTRAINT ${constraint.conname}`);
        console.log(`    ✓ Dropped constraint: ${constraint.conname}`);
      } catch (e) {
        console.log(`    - Could not drop ${constraint.conname}: ${e.message}`);
      }
    }
    
    // Step 3: Distribute the table
    console.log('  Step 3: Distributing contacts table...');
    await knex.raw(`SELECT create_distributed_table('contacts', 'tenant', colocate_with => 'tenants')`);
    console.log('    ✓ Distributed contacts table');
    
    // Step 4: Recreate all valid foreign keys
    console.log('  Step 4: Recreating foreign keys...');
    await recreateForeignKeys(knex, 'contacts', capturedFKs);
    
    console.log('  ✓ Contacts table distributed successfully');
    
  } catch (error) {
    console.error(`  ✗ Failed to distribute contacts: ${error.message}`);
    throw error;
  }
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

  console.log('Undistributing contacts table...');
  
  try {
    const isDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition 
        WHERE logicalrelid = 'contacts'::regclass
      ) as distributed
    `);
    
    if (isDistributed.rows[0].distributed) {
      await knex.raw(`SELECT undistribute_table('contacts')`);
      console.log('  ✓ Undistributed contacts table');
    }
  } catch (error) {
    console.error(`  ✗ Failed to undistribute contacts: ${error.message}`);
  }
};