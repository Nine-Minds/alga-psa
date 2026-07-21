/**
 * The suppressions -> contacts FK was originally declared with a bare
 * ON DELETE SET NULL on the composite (tenant, contact_id) key, which nulls
 * BOTH columns on contact deletion — including NOT NULL tenant, so every
 * delete of a once-suppressed contact failed. Recreate it safely:
 * - PG 15+ on plain Postgres: ON DELETE SET NULL (contact_id) — keeps tenant
 *   and nulls only the link column, which is what "suppression survives
 *   contact deletion" (T007) always meant.
 * - Citus (or PG < 15): plain NO ACTION — Citus refuses SET NULL when the
 *   distribution key is part of the FK, and the column-targeted form does
 *   not exist before PG 15 (same recipe as
 *   20260611150000_fix_tenant_nulling_foreign_keys.cjs).
 *
 * On a fresh chain 20260719100000 already creates the FK in this exact form
 * and this migration is a drop/re-add no-op; it remains for databases that
 * ran the original bare-SET NULL version of that migration.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  const citusRow = await knex.raw(
    "SELECT 1 FROM pg_extension WHERE extname = 'citus' LIMIT 1",
  );
  const versionRow = await knex.raw("SELECT current_setting('server_version_num')::int AS v");
  const columnTargeted = versionRow.rows[0].v >= 150000 && citusRow.rows.length === 0;

  await knex.raw(`
    ALTER TABLE marketing_suppressions
    DROP CONSTRAINT IF EXISTS marketing_suppressions_tenant_contact_id_foreign
  `);
  await knex.raw(`
    ALTER TABLE marketing_suppressions
    ADD CONSTRAINT marketing_suppressions_tenant_contact_id_foreign
    FOREIGN KEY (tenant, contact_id)
    REFERENCES contacts (tenant, contact_name_id)${columnTargeted ? ' ON DELETE SET NULL (contact_id)' : ''}
  `);
};

/**
 * Intentionally a no-op: restoring the bare composite SET NULL would
 * reintroduce the tenant-nulling hazard (and Citus rejects it outright).
 *
 * @returns {Promise<void>}
 */
exports.down = async function down() {};
