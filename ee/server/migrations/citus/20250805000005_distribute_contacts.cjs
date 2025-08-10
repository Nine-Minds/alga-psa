/**
 * Distribute contacts table
 * Companies must be distributed first (contacts has FK to companies)
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

    // Step 1: Drop foreign key constraints that might cause issues
    console.log('  Step 1: Dropping foreign key constraints...');
    const fkConstraints = await knex.raw(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'contacts'::regclass
      AND contype = 'f'
    `);
    
    const droppedFKs = [];
    for (const fk of fkConstraints.rows) {
      try {
        await knex.raw(`ALTER TABLE contacts DROP CONSTRAINT ${fk.conname}`);
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
    
    // Step 4: Recreate FK to companies (both tables now distributed)
    console.log('  Step 4: Recreating foreign key to companies...');
    try {
      await knex.raw(`
        ALTER TABLE contacts 
        ADD CONSTRAINT contacts_tenant_company_id_foreign 
        FOREIGN KEY (tenant, company_id) 
        REFERENCES companies(tenant, company_id) 
        ON DELETE CASCADE
      `);
      console.log('    ✓ Recreated FK to companies');
    } catch (e) {
      console.log(`    - Could not recreate FK to companies: ${e.message}`);
    }
    
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