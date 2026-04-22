/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const duplicateLifecycleRows = await knex('authorization_bundle_revisions')
    .whereIn('lifecycle_state', ['draft', 'published'])
    .groupBy('tenant', 'bundle_id', 'lifecycle_state')
    .havingRaw('count(*) > 1')
    .select('tenant', 'bundle_id', 'lifecycle_state')
    .count('* as count');

  if (duplicateLifecycleRows.length > 0) {
    const sample = duplicateLifecycleRows
      .slice(0, 5)
      .map((row) => `${row.tenant}:${row.bundle_id}:${row.lifecycle_state} (${row.count})`)
      .join(', ');

    throw new Error(
      `Cannot enforce authorization revision lifecycle uniqueness; duplicate draft/published rows already exist. ` +
        `Sample duplicates: ${sample}. ` +
        `Repair path: keep one canonical revision per (tenant, bundle_id, lifecycle_state), archive/delete the extras, then rerun migration 20260422143000. ` +
        `Discovery query: SELECT tenant, bundle_id, lifecycle_state, count(*) FROM authorization_bundle_revisions ` +
        `WHERE lifecycle_state IN ('draft','published') GROUP BY tenant, bundle_id, lifecycle_state HAVING count(*) > 1.`
    );
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS authorization_bundle_revisions_single_draft_idx
    ON authorization_bundle_revisions (tenant, bundle_id)
    WHERE lifecycle_state = 'draft'
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS authorization_bundle_revisions_single_published_idx
    ON authorization_bundle_revisions (tenant, bundle_id)
    WHERE lifecycle_state = 'published'
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS authorization_bundle_revisions_single_published_idx');
  await knex.raw('DROP INDEX IF EXISTS authorization_bundle_revisions_single_draft_idx');
};
