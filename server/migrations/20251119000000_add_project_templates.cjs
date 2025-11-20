/**
 * Add project templates feature
 */
exports.config = { transaction: false };

exports.up = async function(knex) {
  console.log('Creating project template tables...');

  // Core template table
  await knex.schema.createTable('project_templates', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('template_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.string('template_name', 255).notNullable();
    table.text('description');
    table.string('category', 100);

    table.uuid('created_by').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at');

    table.integer('use_count').defaultTo(0).notNullable();
    table.timestamp('last_used_at');

    table.primary(['template_id', 'tenant']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');

    table.index(['tenant']);
    table.index(['tenant', 'category']);
  });

  // Template phases
  await knex.schema.createTable('project_template_phases', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('template_phase_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('template_id').notNullable();

    table.string('phase_name', 255).notNullable();
    table.text('description');
    table.integer('duration_days');
    table.integer('start_offset_days').defaultTo(0);
    table.string('order_key', 255);

    table.primary(['template_phase_id', 'tenant']);
    table.foreign(['tenant', 'template_id']).references(['tenant', 'template_id']).inTable('project_templates').onDelete('CASCADE');

    table.index(['tenant', 'template_id']);
  });

  // Template tasks
  await knex.schema.createTable('project_template_tasks', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('template_task_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('template_phase_id').notNullable();

    table.string('task_name', 255).notNullable();
    table.text('description');
    table.decimal('estimated_hours', 10, 2);
    table.integer('duration_days');
    table.string('task_type_key', 50);
    table.uuid('priority_id');
    table.string('order_key', 255);

    table.primary(['template_task_id', 'tenant']);
    table.foreign(['tenant', 'template_phase_id']).references(['tenant', 'template_phase_id']).inTable('project_template_phases').onDelete('CASCADE');

    table.index(['tenant', 'template_phase_id']);
  });

  // Template dependencies
  await knex.schema.createTable('project_template_dependencies', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('template_dependency_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('template_id').notNullable();

    table.uuid('predecessor_task_id').notNullable();
    table.uuid('successor_task_id').notNullable();
    table.string('dependency_type', 50).notNullable();
    table.integer('lead_lag_days').defaultTo(0);
    table.text('notes');

    table.primary(['template_dependency_id', 'tenant']);
    table.foreign(['tenant', 'template_id']).references(['tenant', 'template_id']).inTable('project_templates').onDelete('CASCADE');
    table.foreign(['tenant', 'predecessor_task_id']).references(['tenant', 'template_task_id']).inTable('project_template_tasks');
    table.foreign(['tenant', 'successor_task_id']).references(['tenant', 'template_task_id']).inTable('project_template_tasks');

    table.index(['tenant', 'template_id']);
  });

  // Template checklists
  await knex.schema.createTable('project_template_checklist_items', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('template_checklist_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('template_task_id').notNullable();

    table.string('item_name', 255).notNullable();
    table.text('description');
    table.integer('order_number').notNullable();

    table.primary(['template_checklist_id', 'tenant']);
    table.foreign(['tenant', 'template_task_id']).references(['tenant', 'template_task_id']).inTable('project_template_tasks').onDelete('CASCADE');

    table.index(['tenant', 'template_task_id']);
  });

  // Template status mappings
  await knex.schema.createTable('project_template_status_mappings', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('template_status_mapping_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('template_id').notNullable();

    table.uuid('status_id');
    table.string('custom_status_name', 100);
    table.integer('display_order').notNullable();

    table.primary(['template_status_mapping_id', 'tenant']);
    table.foreign(['tenant', 'template_id']).references(['tenant', 'template_id']).inTable('project_templates').onDelete('CASCADE');

    table.index(['tenant', 'template_id']);
  });

  // Distribute tables for Citus
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);

  if (citusEnabled.rows[0].enabled) {
    console.log('Distributing project template tables...');

    const tables = [
      'project_templates',
      'project_template_phases',
      'project_template_tasks',
      'project_template_dependencies',
      'project_template_checklist_items',
      'project_template_status_mappings'
    ];

    for (const table of tables) {
      await knex.raw(`SELECT create_distributed_table('${table}', 'tenant')`);
      console.log(`  ✓ Distributed ${table}`);
    }
  }

  console.log('Project template tables created successfully');
};

exports.down = async function(knex) {
  console.log('Dropping project template tables...');

  await knex.schema.dropTableIfExists('project_template_status_mappings');
  await knex.schema.dropTableIfExists('project_template_checklist_items');
  await knex.schema.dropTableIfExists('project_template_dependencies');
  await knex.schema.dropTableIfExists('project_template_tasks');
  await knex.schema.dropTableIfExists('project_template_phases');
  await knex.schema.dropTableIfExists('project_templates');

  console.log('Project template tables dropped successfully');
};
