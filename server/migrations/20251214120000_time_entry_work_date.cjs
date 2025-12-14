/**
 * Time Entry work_date/work_timezone + normalize time_periods boundaries to DATE.
 *
 * Rationale:
 * - Timesheets/period membership should be calendar-date based (user-local), not instant based.
 * - Persist work_date (DATE) computed from start_time in the user's timezone.
 * - Persist work_timezone (IANA tz) used for computation for audit/debug.
 * - Store time_periods.start_date/end_date as DATE to avoid server timezone ambiguity.
 */

function sqlComputeWorkDate(startTimeExpr, timeZoneExpr) {
  // Works whether start_time is `timestamp` or `timestamptz`.
  // - If start_time is timestamp (no tz), treat it as UTC instant.
  // - If start_time is timestamptz, it already represents an instant.
  return `
    (
      CASE
        WHEN pg_typeof(${startTimeExpr}) = 'timestamp without time zone'::regtype
          THEN ((((${startTimeExpr}) AT TIME ZONE 'UTC') AT TIME ZONE ${timeZoneExpr})::date)
        ELSE ((${startTimeExpr}) AT TIME ZONE ${timeZoneExpr})::date
      END
    )
  `;
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

  // Backfill work_date/work_timezone from users.timezone (fallback UTC).
  const workTzExpr = `COALESCE(u.timezone, 'UTC')`;
  const workDateExpr = sqlComputeWorkDate('te.start_time', workTzExpr);

  await knex.raw(`
    UPDATE time_entries te
    SET
      work_timezone = ${workTzExpr},
      work_date = ${workDateExpr}
    FROM users u
    WHERE te.tenant = u.tenant
      AND te.user_id = u.user_id
      AND (te.work_date IS NULL OR te.work_timezone IS NULL)
  `);

  // Final fallback for any rows not covered by the users join.
  const fallbackTzExpr = `COALESCE(te.work_timezone, 'UTC')`;
  const fallbackDateExpr = sqlComputeWorkDate('te.start_time', fallbackTzExpr);

  await knex.raw(`
    UPDATE time_entries te
    SET
      work_timezone = ${fallbackTzExpr},
      work_date = ${fallbackDateExpr}
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

