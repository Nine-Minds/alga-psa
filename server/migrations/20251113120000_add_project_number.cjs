/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Check if column already exists
  const columnExists = await knex.raw(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'projects'
    AND column_name = 'project_number'
  `);

  // Add project_number column to projects table if it doesn't exist
  if (columnExists.rows.length === 0) {
    await knex.schema.alterTable('projects', (table) => {
      table.string('project_number', 50);
      // Note: NOT NULL will be added after backfill
    });
    console.log('✅ Added project_number column');
  } else {
    console.log('ℹ️  project_number column already exists, skipping creation');
  }

  // Check if index exists
  const indexExists = await knex.raw(`
    SELECT indexname
    FROM pg_indexes
    WHERE tablename = 'projects'
    AND indexname = 'idx_projects_tenant_project_number'
  `);

  // Add unique index (partial, only for non-null values initially) if it doesn't exist
  if (indexExists.rows.length === 0) {
    await knex.raw(`
      CREATE UNIQUE INDEX idx_projects_tenant_project_number
      ON projects(tenant, project_number)
      WHERE project_number IS NOT NULL
    `);
    console.log('✅ Created partial unique index');
  } else {
    console.log('ℹ️  Index already exists, skipping creation');
  }

  // Seed next_number table for PROJECT entity type for all existing tenants
  await knex.raw(`
    INSERT INTO next_number (tenant, entity_type, last_number, initial_value, prefix, padding_length)
    SELECT tenant, 'PROJECT', 0, 1, 'PROJECT', 4
    FROM tenants
    ON CONFLICT (tenant, entity_type) DO NOTHING
  `);

  console.log('✅ Seeded next_number table');

  // --- BACKFILL EXISTING PROJECTS ---
  console.log('🚀 Starting project number backfill...\n');

  // Get all tenants
  const tenants = await knex('tenants')
    .select('tenant')
    .orderBy('tenant');

  console.log(`Found ${tenants.length} tenant(s)\n`);

  for (const { tenant } of tenants) {
    console.log(`Processing tenant: ${tenant}`);

    // Get all projects without project_number for this tenant
    const projects = await knex('projects')
      .select('project_id', 'project_name', 'created_at')
      .where({ tenant })
      .whereNull('project_number')
      .orderBy('created_at', 'asc'); // Oldest projects get lowest numbers

    if (projects.length === 0) {
      console.log(`  ✓ No projects to backfill\n`);
      continue;
    }

    console.log(`  Found ${projects.length} project(s) to backfill`);

    // Generate and assign numbers using the PostgreSQL function
    for (const project of projects) {
      const result = await knex.raw(
        `SELECT generate_next_number(:tenant::uuid, 'PROJECT') as number`,
        { tenant }
      );

      const projectNumber = result.rows[0].number;

      await knex('projects')
        .where({ tenant, project_id: project.project_id })
        .update({ project_number: projectNumber });

      console.log(`    ✓ ${projectNumber}: ${project.project_name}`);
    }

    console.log(`  ✅ Completed tenant ${tenant}\n`);
  }

  // Wait for Citus to propagate changes across all shards
  console.log('Waiting for distributed changes to propagate...');
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Verify no NULL values remain before setting NOT NULL
  const nullCount = await knex('projects')
    .whereNull('project_number')
    .count('* as count')
    .first();

  console.log(`\nVerifying backfill: ${nullCount.count} projects with NULL project_number`);

  if (parseInt(nullCount.count) > 0) {
    console.log(`⚠️  Found ${nullCount.count} projects still with NULL project_number`);
    console.log('Attempting additional backfill...\n');

    // Retry backfill for any remaining NULL values
    for (const { tenant } of tenants) {
      const remainingProjects = await knex('projects')
        .select('project_id', 'project_name', 'created_at')
        .where({ tenant })
        .whereNull('project_number')
        .orderBy('created_at', 'asc');

      if (remainingProjects.length === 0) continue;

      console.log(`Tenant ${tenant}: Backfilling ${remainingProjects.length} remaining project(s)`);

      for (const project of remainingProjects) {
        const result = await knex.raw(
          `SELECT generate_next_number(:tenant::uuid, 'PROJECT') as number`,
          { tenant }
        );

        const projectNumber = result.rows[0].number;

        await knex('projects')
          .where({ tenant, project_id: project.project_id })
          .update({ project_number: projectNumber });

        console.log(`    ✓ ${projectNumber}: ${project.project_name}`);
      }
    }

    // Wait for Citus to propagate retry changes
    console.log('Waiting for distributed retry changes to propagate...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Final verification
    const finalNullCount = await knex('projects')
      .whereNull('project_number')
      .count('* as count')
      .first();

    if (parseInt(finalNullCount.count) > 0) {
      throw new Error(`❌ Migration failed: Still have ${finalNullCount.count} projects with NULL project_number!`);
    }
  }

  // Check if column is already NOT NULL
  const isNullable = await knex.raw(`
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_name = 'projects'
    AND column_name = 'project_number'
  `);

  if (isNullable.rows[0]?.is_nullable === 'YES') {
    // Now make the column NOT NULL (after all projects have numbers)
    console.log('Making project_number column NOT NULL...');
    await knex.schema.alterTable('projects', (table) => {
      table.string('project_number', 50).notNullable().alter();
    });
    console.log('✅ Column altered to NOT NULL');
  } else {
    console.log('ℹ️  Column is already NOT NULL, skipping');
  }

  // Check if we need to update the index (drop conditional, create unconditional)
  const conditionalIndex = await knex.raw(`
    SELECT indexdef
    FROM pg_indexes
    WHERE tablename = 'projects'
    AND indexname = 'idx_projects_tenant_project_number'
    AND indexdef LIKE '%WHERE%'
  `);

  if (conditionalIndex.rows.length > 0) {
    // Drop the conditional unique index and create unconditional one
    console.log('Upgrading to unconditional unique index...');
    await knex.raw('DROP INDEX idx_projects_tenant_project_number');
    await knex.raw(`
      CREATE UNIQUE INDEX idx_projects_tenant_project_number
      ON projects(tenant, project_number)
    `);
    console.log('✅ Index upgraded');
  } else {
    console.log('ℹ️  Index is already unconditional');
  }

  console.log('\n✅ Migration complete! All projects now have numbers.');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_projects_tenant_project_number');

  await knex.schema.alterTable('projects', (table) => {
    table.dropColumn('project_number');
  });

  await knex('next_number')
    .where('entity_type', 'PROJECT')
    .delete();
};

// Disable transaction for Citus DB compatibility
// Distributed queries and updates work better outside transactions
exports.config = { transaction: false };
