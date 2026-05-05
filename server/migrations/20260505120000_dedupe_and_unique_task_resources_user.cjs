/**
 * Deduplicate task_resources rows that share (tenant, task_id, additional_user_id),
 * then enforce uniqueness with an index.
 *
 * Background: assignTeamToProjectTask inserted team members with role='team_member'
 * while TaskForm also pushed those same members through addTaskResourceAction,
 * producing duplicate rows (one with role='team_member', one with NULL role) and
 * double notifications. This cleans existing duplicates and prevents recurrence.
 *
 * Citus notes:
 *  - task_resources is distributed by `tenant`. The DELETE is written as DELETE USING
 *    with `tenant` on both sides so Citus can co-locate per shard.
 *  - The unique index leads with `tenant`, satisfying Citus's distributed-uniqueness
 *    requirement.
 *  - Migration is idempotent: re-running after a partial completion produces the same
 *    final state.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  // 1. Audit: how many duplicate groups exist before we touch anything.
  const beforeResult = await knex.raw(`
    SELECT COUNT(*)::int AS dup_groups,
           COALESCE(SUM(extras), 0)::int AS extra_rows
    FROM (
      SELECT COUNT(*) - 1 AS extras
      FROM task_resources
      WHERE additional_user_id IS NOT NULL
      GROUP BY tenant, task_id, additional_user_id
      HAVING COUNT(*) > 1
    ) g;
  `);
  const beforeRow = beforeResult.rows[0] || { dup_groups: 0, extra_rows: 0 };
  console.log(
    `[dedupe_task_resources] Found ${beforeRow.dup_groups} duplicate group(s) ` +
    `comprising ${beforeRow.extra_rows} extra row(s) to delete.`
  );

  // 2. Delete extra rows. Per-(tenant, task_id, additional_user_id) keep the row
  //    with a non-null role (so 'team_member' wins over NULL), then earliest
  //    assigned_at as the tiebreaker. The USING subquery includes `tenant` so the
  //    join is co-located on Citus shards.
  if (beforeRow.extra_rows > 0) {
    const deleteResult = await knex.raw(`
      DELETE FROM task_resources tr
      USING (
        SELECT tenant, assignment_id,
               ROW_NUMBER() OVER (
                 PARTITION BY tenant, task_id, additional_user_id
                 ORDER BY
                   CASE WHEN role IS NOT NULL THEN 0 ELSE 1 END,
                   assigned_at ASC
               ) AS rn
        FROM task_resources
        WHERE additional_user_id IS NOT NULL
      ) ranked
      WHERE tr.tenant = ranked.tenant
        AND tr.assignment_id = ranked.assignment_id
        AND ranked.rn > 1;
    `);
    console.log(
      `[dedupe_task_resources] Deleted ${deleteResult.rowCount ?? 'unknown'} duplicate row(s).`
    );
  }

  // 3. Verify no duplicates remain before adding the constraint.
  const afterResult = await knex.raw(`
    SELECT COUNT(*)::int AS dup_groups
    FROM (
      SELECT 1
      FROM task_resources
      WHERE additional_user_id IS NOT NULL
      GROUP BY tenant, task_id, additional_user_id
      HAVING COUNT(*) > 1
    ) g;
  `);
  const remaining = afterResult.rows[0]?.dup_groups ?? 0;
  if (remaining > 0) {
    throw new Error(
      `[dedupe_task_resources] ${remaining} duplicate group(s) remain after dedupe; aborting before index creation.`
    );
  }

  // 4. Add the unique index. Partial WHERE excludes any legacy NULL additional_user_id
  //    rows so they don't collide. CREATE INDEX (non-concurrent) is fine for a small
  //    table per tenant; Knex's transaction also forbids CONCURRENTLY here.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS task_resources_tenant_task_user_unique
    ON task_resources (tenant, task_id, additional_user_id)
    WHERE additional_user_id IS NOT NULL;
  `);
  console.log('[dedupe_task_resources] Unique index task_resources_tenant_task_user_unique created.');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS task_resources_tenant_task_user_unique;`);
};
