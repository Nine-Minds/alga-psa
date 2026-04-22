/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('authorization_bundles', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('bundle_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('bundle_key').nullable();
    table.text('name').notNullable();
    table.text('description').nullable();
    table.boolean('is_system').notNullable().defaultTo(false);
    table.text('status').notNullable().defaultTo('active');
    table.uuid('published_revision_id').nullable();
    table.uuid('created_by').nullable();
    table.uuid('updated_by').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'bundle_id']);
    table.unique(['tenant', 'bundle_key']);
    table.unique(['tenant', 'name']);
    table.index(['tenant', 'status'], 'authorization_bundles_tenant_status_idx');
    table.check("status IN ('active', 'archived')", undefined, 'authorization_bundles_status_check');

    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
    table.foreign(['tenant', 'updated_by']).references(['tenant', 'user_id']).inTable('users');
  });

  await knex.schema.createTable('authorization_bundle_revisions', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('revision_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('bundle_id').notNullable();
    table.integer('revision_number').notNullable();
    table.text('lifecycle_state').notNullable().defaultTo('draft');
    table.text('summary').nullable();
    table.timestamp('published_at', { useTz: true }).nullable();
    table.uuid('published_by').nullable();
    table.uuid('created_by').nullable();
    table.uuid('updated_by').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'revision_id']);
    table.unique(['tenant', 'bundle_id', 'revision_number']);
    table.index(['tenant', 'bundle_id', 'lifecycle_state'], 'authorization_bundle_revisions_lookup_idx');
    table.check(
      "lifecycle_state IN ('draft', 'published', 'archived')",
      undefined,
      'authorization_bundle_revisions_state_check'
    );

    table.foreign(['tenant', 'bundle_id']).references(['tenant', 'bundle_id']).inTable('authorization_bundles');
    table.foreign(['tenant', 'published_by']).references(['tenant', 'user_id']).inTable('users');
    table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
    table.foreign(['tenant', 'updated_by']).references(['tenant', 'user_id']).inTable('users');
  });

  await knex.schema.alterTable('authorization_bundles', (table) => {
    table
      .foreign(['tenant', 'published_revision_id'])
      .references(['tenant', 'revision_id'])
      .inTable('authorization_bundle_revisions');
  });

  await knex.schema.createTable('authorization_bundle_rules', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('rule_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('bundle_id').notNullable();
    table.uuid('revision_id').notNullable();
    table.text('resource_type').notNullable();
    table.text('action').notNullable();
    table.text('template_key').notNullable();
    table.text('effect').notNullable().defaultTo('narrow');
    table.text('constraint_key').nullable();
    table.jsonb('config').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.integer('position').notNullable().defaultTo(0);
    table.uuid('created_by').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'rule_id']);
    table.index(['tenant', 'revision_id', 'resource_type', 'action'], 'authorization_bundle_rules_lookup_idx');
    table.check("effect = 'narrow'", undefined, 'authorization_bundle_rules_effect_check');

    table
      .foreign(['tenant', 'bundle_id'])
      .references(['tenant', 'bundle_id'])
      .inTable('authorization_bundles')
      .onDelete('CASCADE');
    table
      .foreign(['tenant', 'revision_id'])
      .references(['tenant', 'revision_id'])
      .inTable('authorization_bundle_revisions')
      .onDelete('CASCADE');
    table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
  });

  await knex.schema.createTable('authorization_bundle_assignments', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('assignment_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('bundle_id').notNullable();
    table.text('target_type').notNullable();
    table.uuid('target_id').notNullable();
    table.text('status').notNullable().defaultTo('active');
    table.uuid('created_by').nullable();
    table.uuid('updated_by').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'assignment_id']);
    table.unique(['tenant', 'bundle_id', 'target_type', 'target_id']);
    table.index(['tenant', 'target_type', 'target_id', 'status'], 'authorization_bundle_assignments_target_lookup_idx');
    table.check(
      "target_type IN ('role', 'team', 'user', 'api_key')",
      undefined,
      'authorization_bundle_assignments_target_type_check'
    );
    table.check("status IN ('active', 'disabled')", undefined, 'authorization_bundle_assignments_status_check');

    table
      .foreign(['tenant', 'bundle_id'])
      .references(['tenant', 'bundle_id'])
      .inTable('authorization_bundles')
      .onDelete('CASCADE');
    table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
    table.foreign(['tenant', 'updated_by']).references(['tenant', 'user_id']).inTable('users');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('authorization_bundle_assignments');
  await knex.schema.dropTableIfExists('authorization_bundle_rules');
  await knex.schema.alterTable('authorization_bundles', (table) => {
    table.dropForeign(['tenant', 'published_revision_id']);
  });
  await knex.schema.dropTableIfExists('authorization_bundle_revisions');
  await knex.schema.dropTableIfExists('authorization_bundles');
};
