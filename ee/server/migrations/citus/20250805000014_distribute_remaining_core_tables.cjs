/**
 * Distribute remaining core tables
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

  console.log('Distributing remaining core tables...');
  
  const tables = [
    'comments',
    'document_types',
    'interaction_types',
    'usage_tracking',
    'resources',
    'teams',
    'team_members',
    'user_roles'
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
      
      // Step 2: Drop unique constraints with CASCADE
      console.log(`  Dropping unique constraints for ${table}...`);
      const uniqueConstraints = await knex.raw(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = '${table}'::regclass
        AND contype = 'u'
      `);
      
      for (const constraint of uniqueConstraints.rows) {
        try {
          await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint.conname} CASCADE`);
          console.log(`    ✓ Dropped constraint: ${constraint.conname} with CASCADE`);
        } catch (e) {
          console.log(`    - Could not drop ${constraint.conname}: ${e.message}`);
        }
      }
      
      // Step 2b: Drop check constraints
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
      
      // Step 3: Drop triggers if any
      console.log(`  Dropping triggers for ${table}...`);
      const triggers = await knex.raw(`
        SELECT tgname
        FROM pg_trigger
        WHERE tgrelid = '${table}'::regclass
        AND tgisinternal = false
      `);
      
      for (const trigger of triggers.rows) {
        try {
          await knex.raw(`DROP TRIGGER IF EXISTS ${trigger.tgname} ON ${table}`);
          console.log(`    ✓ Dropped trigger: ${trigger.tgname}`);
        } catch (e) {
          console.log(`    - Could not drop trigger ${trigger.tgname}: ${e.message}`);
        }
      }
      
      // Step 4: Distribute the table
      console.log(`  Distributing ${table}...`);
      await knex.raw(`SELECT create_distributed_table('${table}', 'tenant', colocate_with => 'tenants')`);
      console.log(`    ✓ Distributed ${table}`);
      
    } catch (error) {
      console.error(`  ✗ Failed to distribute ${table}: ${error.message}`);
      throw error;
    }
  }
  
  // Recreate important FKs between distributed tables
  console.log('\nRecreating foreign keys between distributed tables...');
  
  try {
    // team_members -> teams
    await knex.raw(`
      ALTER TABLE team_members 
      ADD CONSTRAINT team_members_tenant_team_id_foreign 
      FOREIGN KEY (tenant, team_id) 
      REFERENCES teams(tenant, team_id) 
      ON DELETE CASCADE
    `);
    console.log('  ✓ Recreated FK: team_members -> teams');
  } catch (e) {
    console.log(`  - Could not recreate FK team_members -> teams: ${e.message}`);
  }
  
  try {
    // team_members -> users
    await knex.raw(`
      ALTER TABLE team_members 
      ADD CONSTRAINT team_members_tenant_user_id_foreign 
      FOREIGN KEY (tenant, user_id) 
      REFERENCES users(tenant, user_id) 
      ON DELETE CASCADE
    `);
    console.log('  ✓ Recreated FK: team_members -> users');
  } catch (e) {
    console.log(`  - Could not recreate FK team_members -> users: ${e.message}`);
  }
  
  try {
    // user_roles -> users  
    await knex.raw(`
      ALTER TABLE user_roles 
      ADD CONSTRAINT user_roles_tenant_user_id_foreign 
      FOREIGN KEY (tenant, user_id) 
      REFERENCES users(tenant, user_id) 
      ON DELETE CASCADE
    `);
    console.log('  ✓ Recreated FK: user_roles -> users');
  } catch (e) {
    console.log(`  - Could not recreate FK user_roles -> users: ${e.message}`);
  }
  
  try {
    // user_roles -> roles
    await knex.raw(`
      ALTER TABLE user_roles 
      ADD CONSTRAINT user_roles_tenant_role_id_foreign 
      FOREIGN KEY (tenant, role_id) 
      REFERENCES roles(tenant, role_id) 
      ON DELETE CASCADE
    `);
    console.log('  ✓ Recreated FK: user_roles -> roles');
  } catch (e) {
    console.log(`  - Could not recreate FK user_roles -> roles: ${e.message}`);
  }
  
  console.log('\n✓ All remaining core tables distributed successfully');
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

  console.log('Undistributing remaining core tables...');
  
  const tables = [
    'user_roles',
    'team_members',
    'teams',
    'resources',
    'usage_tracking',
    'interaction_types',
    'document_types',
    'comments'
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