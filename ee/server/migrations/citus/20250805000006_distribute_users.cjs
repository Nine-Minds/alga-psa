/**
 * Distribute users table
 * Companies must be distributed first (users has FK to companies)
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

  console.log('Distributing users table...');
  
  try {
    // Check if already distributed
    const isDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition 
        WHERE logicalrelid = 'users'::regclass
      ) as distributed
    `);
    
    if (isDistributed.rows[0].distributed) {
      console.log('  Users table already distributed');
      return;
    }

    // Step 1: Drop foreign key constraints that might cause issues
    console.log('  Step 1: Dropping foreign key constraints...');
    const fkConstraints = await knex.raw(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'users'::regclass
      AND contype = 'f'
    `);
    
    const droppedFKs = [];
    for (const fk of fkConstraints.rows) {
      try {
        await knex.raw(`ALTER TABLE users DROP CONSTRAINT ${fk.conname}`);
        droppedFKs.push(fk.conname);
        console.log(`    ✓ Dropped FK: ${fk.conname}`);
      } catch (e) {
        console.log(`    - Could not drop FK ${fk.conname}: ${e.message}`);
      }
    }
    
    // Step 2: Drop unique constraints that don't include tenant
    console.log('  Step 2: Dropping unique constraints...');
    const uniqueConstraints = await knex.raw(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'users'::regclass
      AND contype = 'u'
    `);
    
    for (const constraint of uniqueConstraints.rows) {
      try {
        await knex.raw(`ALTER TABLE users DROP CONSTRAINT ${constraint.conname}`);
        console.log(`    ✓ Dropped constraint: ${constraint.conname}`);
      } catch (e) {
        console.log(`    - Could not drop ${constraint.conname}: ${e.message}`);
      }
    }
    
    // Step 3: Distribute the table
    console.log('  Step 3: Distributing users table...');
    await knex.raw(`SELECT create_distributed_table('users', 'tenant', colocate_with => 'tenants')`);
    console.log('    ✓ Distributed users table');
    
    // Step 4: Recreate FK to companies (both tables now distributed)
    console.log('  Step 4: Recreating foreign key to companies...');
    try {
      await knex.raw(`
        ALTER TABLE users 
        ADD CONSTRAINT users_tenant_company_id_foreign 
        FOREIGN KEY (tenant, company_id) 
        REFERENCES companies(tenant, company_id) 
        ON DELETE CASCADE
      `);
      console.log('    ✓ Recreated FK to companies');
    } catch (e) {
      console.log(`    - Could not recreate FK to companies: ${e.message}`);
    }
    
    // Step 5: Recreate unique constraint on email within tenant
    console.log('  Step 5: Recreating unique constraints...');
    try {
      await knex.raw(`
        ALTER TABLE users 
        ADD CONSTRAINT users_tenant_email_unique 
        UNIQUE (tenant, email)
      `);
      console.log('    ✓ Recreated unique constraint on (tenant, email)');
    } catch (e) {
      console.log(`    - Could not recreate unique constraint: ${e.message}`);
    }
    
    console.log('  ✓ Users table distributed successfully');
    
  } catch (error) {
    console.error(`  ✗ Failed to distribute users: ${error.message}`);
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

  console.log('Undistributing users table...');
  
  try {
    const isDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition 
        WHERE logicalrelid = 'users'::regclass
      ) as distributed
    `);
    
    if (isDistributed.rows[0].distributed) {
      await knex.raw(`SELECT undistribute_table('users')`);
      console.log('  ✓ Undistributed users table');
    }
  } catch (error) {
    console.error(`  ✗ Failed to undistribute users: ${error.message}`);
  }
};