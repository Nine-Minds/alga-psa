/**
 * Distribute project-related tables
 * Dependencies: companies must be distributed first
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

  console.log('Distributing project tables...');
  
  const tables = [
    'projects',
    'project_phases',
    'project_tasks',
    'project_ticket_links',
    'time_entries'
    // 'project_task_links', // Table doesn't exist yet
    // 'project_status_mappings', // Table doesn't exist yet
    // 'time_entry_extensions' // Table doesn't exist yet
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
    // project_phases -> projects
    await knex.raw(`
      ALTER TABLE project_phases 
      ADD CONSTRAINT project_phases_tenant_project_id_foreign 
      FOREIGN KEY (tenant, project_id) 
      REFERENCES projects(tenant, project_id) 
      ON DELETE CASCADE
    `);
    console.log('  ✓ Recreated FK: project_phases -> projects');
  } catch (e) {
    console.log(`  - Could not recreate FK project_phases -> projects: ${e.message}`);
  }
  
  try {
    // project_tasks -> project_phases
    await knex.raw(`
      ALTER TABLE project_tasks 
      ADD CONSTRAINT project_tasks_tenant_phase_id_foreign 
      FOREIGN KEY (tenant, phase_id) 
      REFERENCES project_phases(tenant, phase_id) 
      ON DELETE CASCADE
    `);
    console.log('  ✓ Recreated FK: project_tasks -> project_phases');
  } catch (e) {
    console.log(`  - Could not recreate FK project_tasks -> project_phases: ${e.message}`);
  }
  
  try {
    // time_entries -> project_tasks
    await knex.raw(`
      ALTER TABLE time_entries 
      ADD CONSTRAINT time_entries_tenant_task_id_foreign 
      FOREIGN KEY (tenant, task_id) 
      REFERENCES project_tasks(tenant, task_id) 
      ON DELETE CASCADE
    `);
    console.log('  ✓ Recreated FK: time_entries -> project_tasks');
  } catch (e) {
    console.log(`  - Could not recreate FK time_entries -> project_tasks: ${e.message}`);
  }
  
  try {
    // projects -> companies
    await knex.raw(`
      ALTER TABLE projects 
      ADD CONSTRAINT projects_tenant_company_id_foreign 
      FOREIGN KEY (tenant, company_id) 
      REFERENCES companies(tenant, company_id) 
      ON DELETE CASCADE
    `);
    console.log('  ✓ Recreated FK: projects -> companies');
  } catch (e) {
    console.log(`  - Could not recreate FK projects -> companies: ${e.message}`);
  }
  
  console.log('\n✓ All project tables distributed successfully');
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