/**
 * Create user_activity_groups and user_activity_group_items tables.
 *
 * These tables let users organize their activities (tickets, project tasks,
 * schedule entries, workflow tasks) into personal, user-defined groups that
 * persist across sessions. They also track per-user ordering (sort_order)
 * within each group for drag-to-reorder.
 *
 * Scope: per (tenant, user_id). Groups are private to each user.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // ---- user_activity_groups ---------------------------------------------
  await knex.schema.createTable('user_activity_groups', function (table) {
    table.uuid('group_id').defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable();
    table.uuid('user_id').notNullable();

    table.text('group_name').notNullable();
    table.integer('sort_order').notNullable().defaultTo(0);
    table.boolean('is_collapsed').notNullable().defaultTo(false);

    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'group_id']);
  });

  // Unique group names per user
  await knex.schema.raw(`
    CREATE UNIQUE INDEX idx_user_activity_groups_unique_name
    ON user_activity_groups (tenant, user_id, group_name)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_user_activity_groups_tenant_user
    ON user_activity_groups (tenant, user_id, sort_order)
  `);

  // ---- user_activity_group_items ----------------------------------------
  await knex.schema.createTable('user_activity_group_items', function (table) {
    table.uuid('item_id').defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable();
    table.uuid('group_id').notNullable();

    // The referenced activity. activity_id is polymorphic: it's the source
    // entity id (ticket_id, task_id, schedule entry_id, workflow task_id).
    // We intentionally do NOT declare FKs because activity_id may reference
    // different tables depending on activity_type, and cleanup is handled
    // in application logic (or left dangling, to be cleaned by a future job).
    table.text('activity_id').notNullable();
    table.text('activity_type').notNullable();

    table.integer('sort_order').notNullable().defaultTo(0);

    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'item_id']);
  });

  // An activity can only belong to one group per user — enforce via unique
  // on (tenant, group_id, activity_id, activity_type). This allows the same
  // activity to be referenced from different users' groups (different group_id).
  await knex.schema.raw(`
    CREATE UNIQUE INDEX idx_user_activity_group_items_unique
    ON user_activity_group_items (tenant, group_id, activity_id, activity_type)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_user_activity_group_items_group_sort
    ON user_activity_group_items (tenant, group_id, sort_order)
  `);

  // ---- Citus distribution (optional) ------------------------------------
  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    await knex.raw("SELECT create_distributed_table('user_activity_groups', 'tenant')");
    await knex.raw("SELECT create_distributed_table('user_activity_group_items', 'tenant')");
  } else {
    console.warn(
      '[create_user_activity_groups] Skipping create_distributed_table (function unavailable)'
    );
  }

  console.log('✅ Created user_activity_groups and user_activity_group_items tables');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('user_activity_group_items');
  await knex.schema.dropTableIfExists('user_activity_groups');
  console.log('✅ Dropped user_activity_groups and user_activity_group_items tables');
};

// Disable transaction for Citus DB compatibility
exports.config = { transaction: false };
