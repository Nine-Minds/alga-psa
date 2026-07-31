/**
 * Per-weekday work schedule for internal users.
 *
 * This is deliberately NOT `availability_settings`. That table answers "when may
 * a client book this person", which is a publishing decision: a dispatch-only
 * technician is on shift all day and exposes no bookable hours at all. This
 * table answers "when is this person on the clock", which is what utilization
 * capacity and dispatch load need.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  // Guarded: with transaction:false a failure after this CREATE (e.g. in the
  // Citus distribution below) leaves the table behind on retry.
  if (!(await knex.schema.hasTable('user_work_schedules'))) {
    await knex.schema.createTable('user_work_schedules', (table) => {
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
      table.uuid('user_id').notNullable();
      table.integer('day_of_week').notNullable();
      table.time('start_time').notNullable();
      table.time('end_time').notNullable();
      table.boolean('is_working').notNullable().defaultTo(true);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      // One row per user per weekday; tenant leads so Citus accepts the key.
      table.primary(['tenant', 'user_id', 'day_of_week']);
      table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users').onDelete('CASCADE');
    });

    await knex.raw(`
      ALTER TABLE user_work_schedules
        ADD CONSTRAINT chk_user_work_schedules_day_of_week
        CHECK (day_of_week BETWEEN 0 AND 6);
    `);
    // A zero-length or inverted window would silently contribute no capacity.
    await knex.raw(`
      ALTER TABLE user_work_schedules
        ADD CONSTRAINT chk_user_work_schedules_window
        CHECK (end_time > start_time);
    `);
  }

  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_extension
      WHERE extname = 'citus'
    ) AS enabled;
  `);

  if (citusEnabled.rows?.[0]?.enabled) {
    const alreadyDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_dist_partition
        WHERE logicalrelid = 'user_work_schedules'::regclass
      ) AS is_distributed;
    `);

    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      // Colocate with users when they are distributed, so the FK and the
      // report's per-user reads stay shard-local.
      const usersDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1
          FROM pg_dist_partition
          WHERE logicalrelid = 'users'::regclass
        ) AS is_distributed;
      `);

      if (usersDistributed.rows?.[0]?.is_distributed) {
        await knex.raw("SELECT create_distributed_table('user_work_schedules', 'tenant', colocate_with => 'users')");
      } else {
        await knex.raw("SELECT create_distributed_table('user_work_schedules', 'tenant')");
      }
    }
  } else {
    console.warn('[create_user_work_schedules] Skipping create_distributed_table (Citus extension unavailable)');
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('user_work_schedules');
};

// create_distributed_table cannot run inside a transaction block.
exports.config = { transaction: false };
