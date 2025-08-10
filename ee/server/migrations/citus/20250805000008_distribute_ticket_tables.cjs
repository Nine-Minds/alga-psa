/**
 * Distribute ticket-related tables
 * Dependencies: companies, contacts, users must be distributed first
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

  console.log('Distributing ticket tables...');
  
  const tables = [
    'tickets',
    'ticket_comments',
    'ticket_resources',
    'ticket_links',
    'ticket_assignments'
  ];
  
  for (const table of tables) {
    try {
      console.log(`\nProcessing ${table}...`);
      
      // Check if already distributed
      const isDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = '${table}'::regclass
        ) as distributed
      `);
      
      if (isDistributed.rows[0].distributed) {
        console.log(`  ${table} already distributed`);
        continue;
      }

      // Step 1: Drop foreign key constraints
      console.log(`  Dropping foreign key constraints for ${table}...`);
      const fkConstraints = await knex.raw(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = '${table}'::regclass
        AND contype = 'f'
      `);
      
      for (const fk of fkConstraints.rows) {
        try {
          await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${fk.conname}`);
          console.log(`    ✓ Dropped FK: ${fk.conname}`);
        } catch (e) {
          console.log(`    - Could not drop FK ${fk.conname}: ${e.message}`);
        }
      }
      
      // Step 2: Drop unique constraints
      console.log(`  Dropping unique constraints for ${table}...`);
      const uniqueConstraints = await knex.raw(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = '${table}'::regclass
        AND contype = 'u'
      `);
      
      for (const constraint of uniqueConstraints.rows) {
        try {
          // Use CASCADE for constraints that might have dependencies
          await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint.conname} CASCADE`);
          console.log(`    ✓ Dropped constraint: ${constraint.conname} with CASCADE`);
        } catch (e) {
          console.log(`    - Could not drop ${constraint.conname}: ${e.message}`);
        }
      }
      
      // Step 2b: Also handle any check constraints that might block distribution
      console.log(`  Dropping check constraints for ${table}...`);
      const checkConstraints = await knex.raw(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = '${table}'::regclass
        AND contype = 'c'
        AND conname NOT LIKE '%_not_null'
      `);
      
      for (const constraint of checkConstraints.rows) {
        try {
          await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint.conname} CASCADE`);
          console.log(`    ✓ Dropped check constraint: ${constraint.conname}`);
        } catch (e) {
          console.log(`    - Could not drop check ${constraint.conname}: ${e.message}`);
        }
      }
      
      // Step 3: Distribute the table
      console.log(`  Distributing ${table}...`);
      await knex.raw(`SELECT create_distributed_table('${table}', 'tenant', colocate_with => 'tenants')`);
      console.log(`    ✓ Distributed ${table}`);
      
    } catch (error) {
      console.error(`  ✗ Failed to distribute ${table}: ${error.message}`);
      throw error;
    }
  }
  
  // After all tables are distributed, recreate critical FKs between distributed tables
  console.log('\nRecreating foreign keys between distributed tables...');
  
  try {
    // ticket_comments -> tickets
    await knex.raw(`
      ALTER TABLE ticket_comments 
      ADD CONSTRAINT ticket_comments_tenant_ticket_id_foreign 
      FOREIGN KEY (tenant, ticket_id) 
      REFERENCES tickets(tenant, ticket_id) 
      ON DELETE CASCADE
    `);
    console.log('  ✓ Recreated FK: ticket_comments -> tickets');
  } catch (e) {
    console.log(`  - Could not recreate FK ticket_comments -> tickets: ${e.message}`);
  }
  
  try {
    // ticket_resources -> tickets
    await knex.raw(`
      ALTER TABLE ticket_resources 
      ADD CONSTRAINT ticket_resources_tenant_ticket_id_foreign 
      FOREIGN KEY (tenant, ticket_id) 
      REFERENCES tickets(tenant, ticket_id) 
      ON DELETE CASCADE
    `);
    console.log('  ✓ Recreated FK: ticket_resources -> tickets');
  } catch (e) {
    console.log(`  - Could not recreate FK ticket_resources -> tickets: ${e.message}`);
  }
  
  try {
    // tickets -> companies
    await knex.raw(`
      ALTER TABLE tickets 
      ADD CONSTRAINT tickets_tenant_company_id_foreign 
      FOREIGN KEY (tenant, company_id) 
      REFERENCES companies(tenant, company_id) 
      ON DELETE CASCADE
    `);
    console.log('  ✓ Recreated FK: tickets -> companies');
  } catch (e) {
    console.log(`  - Could not recreate FK tickets -> companies: ${e.message}`);
  }
  
  try {
    // tickets -> contacts
    await knex.raw(`
      ALTER TABLE tickets 
      ADD CONSTRAINT tickets_tenant_contact_name_id_foreign 
      FOREIGN KEY (tenant, contact_name_id) 
      REFERENCES contacts(tenant, contact_name_id) 
      ON DELETE SET NULL
    `);
    console.log('  ✓ Recreated FK: tickets -> contacts');
  } catch (e) {
    console.log(`  - Could not recreate FK tickets -> contacts: ${e.message}`);
  }
  
  console.log('\n✓ All ticket tables distributed successfully');
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

  console.log('Undistributing ticket tables...');
  
  const tables = [
    'ticket_comments',
    'ticket_resources',
    'ticket_links',
    'ticket_assignments',
    'tickets'
  ];
  
  for (const table of tables) {
    try {
      const isDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = '${table}'::regclass
        ) as distributed
      `);
      
      if (isDistributed.rows[0].distributed) {
        await knex.raw(`SELECT undistribute_table('${table}')`);
        console.log(`  ✓ Undistributed ${table}`);
      }
    } catch (error) {
      console.error(`  ✗ Failed to undistribute ${table}: ${error.message}`);
    }
  }
};