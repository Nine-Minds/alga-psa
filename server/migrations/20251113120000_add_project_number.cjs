/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Add project_number column to projects table
  await knex.schema.alterTable('projects', (table) => {
    table.string('project_number', 50);
    // Note: NOT NULL will be added after backfill
  });

  // Add unique index (partial, only for non-null values initially)
  await knex.raw(`
    CREATE UNIQUE INDEX idx_projects_tenant_project_number
    ON projects(tenant, project_number)
    WHERE project_number IS NOT NULL
  `);

  // Seed next_number table for PROJECT entity type for all existing tenants
  await knex.raw(`
    INSERT INTO next_number (tenant, entity_type, last_number, initial_value, prefix, padding_length)
    SELECT tenant, 'PROJECT', 0, 1, 'PROJECT', 4
    FROM tenants
    ON CONFLICT (tenant, entity_type) DO NOTHING
  `);

  console.log('✅ Added project_number column and seeded next_number table');

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

  // Now make the column NOT NULL (after all projects have numbers)
  console.log('Making project_number column NOT NULL...');
  await knex.schema.alterTable('projects', (table) => {
    table.string('project_number', 50).notNullable().alter();
  });

  // Drop the conditional unique index and create unconditional one
  await knex.raw('DROP INDEX idx_projects_tenant_project_number');
  await knex.raw(`
    CREATE UNIQUE INDEX idx_projects_tenant_project_number
    ON projects(tenant, project_number)
  `);

  console.log('\n✅ Backfill complete! All projects now have numbers.');
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
