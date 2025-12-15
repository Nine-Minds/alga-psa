/**
 * Time Entry work_date/work_timezone + normalize time_periods boundaries to DATE.
 *
 * Rationale:
 * - Timesheets/period membership should be calendar-date based (user-local), not instant based.
 * - Persist work_date (DATE) computed from start_time in the user's timezone.
 * - Persist work_timezone (IANA tz) used for computation for audit/debug.
 * - Store time_periods.start_date/end_date as DATE to avoid server timezone ambiguity.
 *
 * Note: CitusDB doesn't allow non-IMMUTABLE functions (like AT TIME ZONE) in CASE/COALESCE
 * within distributed UPDATE queries. We work around this by splitting into multiple simple UPDATEs.
 */

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

  // Backfill work_date/work_timezone from users.timezone.
  // Split into separate queries to avoid CitusDB's non-IMMUTABLE function restrictions.

  // Step 1: Update entries where user has a timezone set
  // start_time is timestamptz, so we convert directly to the user's timezone
  await knex.raw(`
    UPDATE time_entries te
    SET
      work_timezone = u.timezone,
      work_date = (te.start_time AT TIME ZONE u.timezone)::date
    FROM users u
    WHERE te.tenant = u.tenant
      AND te.user_id = u.user_id
      AND u.timezone IS NOT NULL
      AND (te.work_date IS NULL OR te.work_timezone IS NULL)
  `);

  // Step 2: Update entries where user has no timezone (use UTC)
  await knex.raw(`
    UPDATE time_entries te
    SET
      work_timezone = 'UTC',
      work_date = (te.start_time AT TIME ZONE 'UTC')::date
    FROM users u
    WHERE te.tenant = u.tenant
      AND te.user_id = u.user_id
      AND u.timezone IS NULL
      AND (te.work_date IS NULL OR te.work_timezone IS NULL)
  `);

  // Step 3: Fallback for any entries without a matching user (use UTC)
  await knex.raw(`
    UPDATE time_entries te
    SET
      work_timezone = 'UTC',
      work_date = (te.start_time AT TIME ZONE 'UTC')::date
    WHERE te.work_date IS NULL OR te.work_timezone IS NULL
  `);

  await knex.raw(`ALTER TABLE time_entries ALTER COLUMN work_date SET NOT NULL`);
  await knex.raw(`ALTER TABLE time_entries ALTER COLUMN work_timezone SET NOT NULL`);

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

