/**
 * Add task assignment tracking for project templates
 * Stores user_id assignments (primary and additional agents) from source projects
 */
exports.config = { transaction: false };

exports.up = async function(knex) {
  console.log('Creating project_template_task_assignments table...');

  await knex.schema.createTable('project_template_task_assignments', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('template_assignment_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('template_task_id').notNullable();
    table.uuid('user_id').notNullable();
    table.boolean('is_primary').defaultTo(false).notNullable();

    table.primary(['template_assignment_id', 'tenant']);
    table.foreign(['tenant', 'template_task_id'])
      .references(['tenant', 'template_task_id'])
      .inTable('project_template_tasks')
      .onDelete('CASCADE');
    table.foreign(['tenant', 'user_id'])
      .references(['tenant', 'user_id'])
      .inTable('users');

    table.index(['tenant', 'template_task_id']);
    table.index(['tenant', 'user_id']);
  });

  // Distribute table for Citus
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);

  if (citusEnabled.rows[0].enabled) {
    console.log('Distributing project_template_task_assignments table...');
    await knex.raw(`SELECT create_distributed_table('project_template_task_assignments', 'tenant')`);
    console.log('  ✓ Distributed project_template_task_assignments');
  }

  console.log('project_template_task_assignments table created successfully');
};

exports.down = async function(knex) {
  console.log('Dropping project_template_task_assignments table...');
  await knex.schema.dropTableIfExists('project_template_task_assignments');
  console.log('project_template_task_assignments table dropped successfully');
};
