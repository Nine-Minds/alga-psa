/**
 * Deduplicate `resources` rows that share (tenant, user_id), then enforce
 * uniqueness with an index.
 *
 * Background: the resources row is the per-user capacity record read by the
 * Employee Utilization report and written by updateUserCapacity. Nothing has
 * ever guaranteed a single row per user, so a report reading one row (or an
 * aggregate) could disagree with the row the editor writes.
 *
 * Citus notes:
 *  - resources is distributed by `tenant`. The DELETE is written as DELETE USING
 *    with `tenant` on both sides so Citus can co-locate per shard.
 *  - The unique index leads with `tenant`, satisfying Citus's distributed-uniqueness
 *    requirement.
 *  - Migration is idempotent: re-running after a partial completion produces the
 *    same final state.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const beforeResult = await knex.raw(`
    SELECT COUNT(*)::int AS dup_groups,
           COALESCE(SUM(extras), 0)::int AS extra_rows
    FROM (
      SELECT COUNT(*) - 1 AS extras
      FROM resources
      GROUP BY tenant, user_id
      HAVING COUNT(*) > 1
    ) g;
  `);
  const beforeRow = beforeResult.rows[0] || { dup_groups: 0, extra_rows: 0 };
  console.log(
    `[dedupe_resources] Found ${beforeRow.dup_groups} duplicate group(s) ` +
    `comprising ${beforeRow.extra_rows} extra row(s) to delete.`
  );

  // Keep the most useful row per (tenant, user_id): one that actually carries a
  // weekly capacity wins, then the most recently updated, then the oldest.
  if (beforeRow.extra_rows > 0) {
    const deleteResult = await knex.raw(`
      DELETE FROM resources r
      USING (
        SELECT tenant, resource_id,
               ROW_NUMBER() OVER (
                 PARTITION BY tenant, user_id
                 ORDER BY
                   CASE WHEN max_weekly_capacity IS NOT NULL THEN 0 ELSE 1 END,
                   updated_at DESC NULLS LAST,
                   created_at ASC NULLS LAST
               ) AS rn
        FROM resources
      ) ranked
      WHERE r.tenant = ranked.tenant
        AND r.resource_id = ranked.resource_id
        AND ranked.rn > 1;
    `);
    console.log(
      `[dedupe_resources] Deleted ${deleteResult.rowCount ?? 'unknown'} duplicate row(s).`
    );
  }

  const afterResult = await knex.raw(`
    SELECT COUNT(*)::int AS dup_groups
    FROM (
      SELECT 1
      FROM resources
      GROUP BY tenant, user_id
      HAVING COUNT(*) > 1
    ) g;
  `);
  const remaining = afterResult.rows[0]?.dup_groups ?? 0;
  if (remaining > 0) {
    throw new Error(
      `[dedupe_resources] ${remaining} duplicate group(s) remain after dedupe; aborting before index creation.`
    );
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS resources_tenant_user_unique
    ON resources (tenant, user_id);
  `);
  console.log('[dedupe_resources] Unique index resources_tenant_user_unique created.');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS resources_tenant_user_unique;`);
};
