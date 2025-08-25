/**
 * Distribute companies table only - simplified version
 * Handles all constraints properly
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

  console.log('Distributing companies table...');
  
  try {
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

    // Step 1: Get ALL constraints on companies table (skip problematic ones)
    console.log('  Step 1: Identifying all constraints on companies table...');
    const constraints = await knex.raw(`
      SELECT conname, contype
      FROM pg_constraint
      WHERE conrelid = 'companies'::regclass
      AND contype IN ('u', 'c', 'x')  -- unique, check, exclusion constraints
      AND conname NOT IN ('companies_pkey', 'companies_company_id_unique')  -- Skip PK and problematic unique
    `);
    
    const droppedConstraints = [];
    
    // Step 2: Drop all problematic constraints
    console.log('  Step 2: Dropping all non-FK constraints...');
    for (const constraint of constraints.rows) {
      try {
        await knex.raw(`ALTER TABLE companies DROP CONSTRAINT ${constraint.conname}`);
        droppedConstraints.push(constraint.conname);
        console.log(`    ✓ Dropped constraint: ${constraint.conname}`);
      } catch (e) {
        console.log(`    - Could not drop ${constraint.conname}: ${e.message}`);
      }
    }
    
    // Step 3: Capture and drop all foreign key constraints
    console.log('  Step 3: Capturing and dropping foreign key constraints...');
    const capturedFKs = await dropAndCaptureForeignKeys(knex, 'companies');
    
    // Step 4: Try to drop the problematic unique constraint with CASCADE
    console.log('  Step 4: Handling problematic unique constraint...');
    try {
      await knex.raw(`ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_company_id_unique CASCADE`);
      console.log('    ✓ Dropped companies_company_id_unique with CASCADE');
    } catch (e) {
      console.log('    - Could not drop companies_company_id_unique');
    }
    
    // Step 5: Distribute the table
    console.log('  Step 5: Distributing companies table...');
    await knex.raw(`SELECT create_distributed_table('companies', 'tenant', colocate_with => 'tenants')`);
    console.log('    ✓ Distributed companies table');
    
    // Step 6: Recreate only Citus-compatible constraints
    console.log('  Step 6: Recreating Citus-compatible constraints...');
    
    // Only recreate constraints that include the distribution key (tenant)
    try {
      // Unique constraint on tenant + company_name
      await knex.raw(`
        ALTER TABLE companies 
        ADD CONSTRAINT companies_tenant_company_name_unique 
        UNIQUE (tenant, company_name)
      `);
      console.log('    ✓ Recreated unique constraint on (tenant, company_name)');
    } catch (e) {
      console.log(`    - Could not recreate unique constraint: ${e.message}`);
    }
    
    // Step 7: Recreate all valid foreign keys
    console.log('  Step 7: Recreating foreign keys...');
    await recreateForeignKeys(knex, 'companies', capturedFKs);
    
    console.log('  ✓ Companies table distributed successfully');
    
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