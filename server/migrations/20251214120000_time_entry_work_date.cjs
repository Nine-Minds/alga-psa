/**
 * Time Entry work_date/work_timezone + normalize time_periods boundaries to DATE.
 *
 * Rationale:
 * - Timesheets/period membership should be calendar-date based (user-local), not instant based.
 * - Persist work_date (DATE) computed from start_time in the user's timezone.
 * - Persist work_timezone (IANA tz) used for computation for audit/debug.
 * - Store time_periods.start_date/end_date as DATE to avoid server timezone ambiguity.
 *
 * Note: CitusDB requires special handling for distributed tables:
 * - Use run_command_on_shards for SET NOT NULL
 * - Update pg_attribute for coordinator metadata
 */

// Disable transaction wrapping - CitusDB DDL needs to commit before DML can see new columns on shards
exports.config = { transaction: false };

/**
 * Check if a table is distributed in Citus.
 */
async function isCitusDistributedTable(knex, tableName) {
  try {
    const result = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass
      ) as is_distributed
    `, [tableName]);
    return result.rows[0]?.is_distributed === true;
  } catch (error) {
    // pg_dist_partition doesn't exist - standard PostgreSQL
    return false;
  }
}

/**
 * Wait for Citus propagation.
 */
async function waitForCitusPropagation(ms, message) {
  console.log(message);
  await new Promise(resolve => setTimeout(resolve, ms));
}

exports.up = async function up(knex) {
  const hasWorkDate = await knex.schema.hasColumn('time_entries', 'work_date');
  const hasWorkTimezone = await knex.schema.hasColumn('time_entries', 'work_timezone');

  if (!hasWorkDate || !hasWorkTimezone) {
    await knex.schema.alterTable('time_entries', function (table) {
      if (!hasWorkDate) table.date('work_date').nullable();
      if (!hasWorkTimezone) table.text('work_timezone').nullable();
    });
  }

  // Normalize time_periods boundaries to DATE (timezone-agnostic).
  // Use an explicit UTC interpretation for safety (regardless of current column type).
  await knex.raw(`
    ALTER TABLE time_periods
      ALTER COLUMN start_date TYPE date USING ((start_date AT TIME ZONE 'UTC')::date),
      ALTER COLUMN end_date TYPE date USING ((end_date AT TIME ZONE 'UTC')::date)
  `);

  // Get all tenants with time entries that need updating
  const tenantsResult = await knex.raw(`
    SELECT DISTINCT tenant FROM time_entries
    WHERE work_date IS NULL OR work_timezone IS NULL
  `);
  const tenants = tenantsResult.rows.map(r => r.tenant);

  // Process each tenant separately to ensure CitusDB routes to correct shards.
  // We use string interpolation with explicit UUID cast instead of ? parameters
  // to avoid potential Knex/pg UUID binding issues.
  for (const tenant of tenants) {
    const tenantStr = String(tenant);

    // Step 1: Update entries where user has a timezone set
    await knex.raw(`
      UPDATE time_entries te
      SET
        work_timezone = u.timezone,
        work_date = (te.start_time AT TIME ZONE u.timezone)::date
      FROM users u
      WHERE te.tenant = '${tenantStr}'::uuid
        AND te.tenant = u.tenant
        AND te.user_id = u.user_id
        AND u.timezone IS NOT NULL
        AND te.start_time IS NOT NULL
        AND (te.work_date IS NULL OR te.work_timezone IS NULL)
    `);

    // Step 2: Update entries where user has no timezone (use UTC)
    await knex.raw(`
      UPDATE time_entries te
      SET
        work_timezone = 'UTC',
        work_date = (te.start_time AT TIME ZONE 'UTC')::date
      FROM users u
      WHERE te.tenant = '${tenantStr}'::uuid
        AND te.tenant = u.tenant
        AND te.user_id = u.user_id
        AND u.timezone IS NULL
        AND te.start_time IS NOT NULL
        AND (te.work_date IS NULL OR te.work_timezone IS NULL)
    `);

    // Step 3: Fallback for entries with start_time but no matching user (use UTC)
    await knex.raw(`
      UPDATE time_entries
      SET
        work_timezone = 'UTC',
        work_date = (start_time AT TIME ZONE 'UTC')::date
      WHERE tenant = '${tenantStr}'::uuid
        AND start_time IS NOT NULL
        AND (work_date IS NULL OR work_timezone IS NULL)
    `);

    // Step 4: Final fallback - derive from created_at if start_time is somehow NULL
    await knex.raw(`
      UPDATE time_entries
      SET
        work_timezone = 'UTC',
        work_date = (created_at AT TIME ZONE 'UTC')::date
      WHERE tenant = '${tenantStr}'::uuid
        AND start_time IS NULL
        AND created_at IS NOT NULL
        AND (work_date IS NULL OR work_timezone IS NULL)
    `);

    // Step 5: Ultimate fallback for this tenant - use current date
    await knex.raw(`
      UPDATE time_entries
      SET
        work_timezone = 'UTC',
        work_date = CURRENT_DATE
      WHERE tenant = '${tenantStr}'::uuid
        AND (work_date IS NULL OR work_timezone IS NULL)
    `);
  }

  // Wait for Citus to propagate changes across all shards
  await waitForCitusPropagation(3000, 'Waiting for distributed changes to propagate...');

  // Verify no NULLs remain before setting NOT NULL
  const nullCheck = await knex.raw(`
    SELECT COUNT(*) as cnt FROM time_entries
    WHERE work_date IS NULL OR work_timezone IS NULL
  `);
  const nullCount = parseInt(nullCheck.rows[0].cnt, 10);
  if (nullCount > 0) {
    throw new Error(`Migration failed: ${nullCount} time_entries still have NULL work_date/work_timezone`);
  }

  // Check if time_entries is a Citus distributed table
  const isCitusDistributed = await isCitusDistributedTable(knex, 'time_entries');

  if (isCitusDistributed) {
    console.log('Detected Citus distributed table, setting NOT NULL on all shards...');

    // Set NOT NULL on all shards first
    await knex.raw(`
      SELECT * FROM run_command_on_shards(
        'time_entries',
        $$ALTER TABLE %s ALTER COLUMN work_date SET NOT NULL$$
      )
    `);
    await knex.raw(`
      SELECT * FROM run_command_on_shards(
        'time_entries',
        $$ALTER TABLE %s ALTER COLUMN work_timezone SET NOT NULL$$
      )
    `);
    console.log('✅ Set NOT NULL on all shards');

    // Update coordinator metadata
    await knex.raw(`
      UPDATE pg_attribute
      SET attnotnull = true
      WHERE attrelid = 'time_entries'::regclass
      AND attname = 'work_date'
      AND attnotnull = false
    `);
    await knex.raw(`
      UPDATE pg_attribute
      SET attnotnull = true
      WHERE attrelid = 'time_entries'::regclass
      AND attname = 'work_timezone'
      AND attnotnull = false
    `);
    console.log('✅ Updated coordinator metadata');
  } else {
    // Standard PostgreSQL
    await knex.raw(`ALTER TABLE time_entries ALTER COLUMN work_date SET NOT NULL`);
    await knex.raw(`ALTER TABLE time_entries ALTER COLUMN work_timezone SET NOT NULL`);
  }

  // Indexes for common access patterns (include tenant first for shard pruning / multi-tenancy).
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS time_entries_tenant_user_work_date_idx
      ON time_entries (tenant, user_id, work_date)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS time_entries_tenant_work_date_idx
      ON time_entries (tenant, work_date)
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS time_entries_tenant_user_work_date_idx`);
  await knex.raw(`DROP INDEX IF EXISTS time_entries_tenant_work_date_idx`);

  const hasWorkDate = await knex.schema.hasColumn('time_entries', 'work_date');
  const hasWorkTimezone = await knex.schema.hasColumn('time_entries', 'work_timezone');
  if (hasWorkDate || hasWorkTimezone) {
    await knex.schema.alterTable('time_entries', function (table) {
      if (hasWorkDate) table.dropColumn('work_date');
      if (hasWorkTimezone) table.dropColumn('work_timezone');
    });
  }

  // Revert time_periods boundaries back to timestamp (historically used).
  await knex.raw(`
    ALTER TABLE time_periods
      ALTER COLUMN start_date TYPE timestamp USING (start_date::timestamp),
      ALTER COLUMN end_date TYPE timestamp USING (end_date::timestamp)
  `);
};

