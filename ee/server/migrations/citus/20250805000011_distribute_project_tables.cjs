/**
 * Distribute project-related tables
 * Dependencies: companies must be distributed first
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

  console.log('Distributing project tables...');
  
  const tables = [
    'projects',
    'project_phases',
    'project_tasks',
    'project_ticket_links',
    'time_entries'
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

      // Step 1: Capture and drop foreign key constraints


      console.log(`  Capturing and dropping foreign key constraints for ${table}...`);


      const capturedFKs = await dropAndCaptureForeignKeys(knex, table);
      
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
      
      // Recreate foreign keys for this table
      console.log(`  Recreating foreign keys for ${table}...`);
      await recreateForeignKeys(knex, table, capturedFKs);
      
    } catch (error) {
      console.error(`  ✗ Failed to distribute ${table}: ${error.message}`);
      throw error;
    }
  }
  
  console.log('\n✓ All tables distributed successfully');
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

  console.log('Undistributing project tables...');
  
  const tables = [
    'time_entries',
    'project_ticket_links',
    'project_tasks',
    'project_phases',
    'projects'
    // Removed non-existent tables
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