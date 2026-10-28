/**
 * Migration: an unlinked mapping must stop owning its external target.
 *
 * Unlinking a mapping tombstones the row (deleted_at set, sync_status
 * 'unlinked') instead of deleting it, so a later export of a previously-linked
 * document is told to relink-or-recreate rather than silently duplicating a
 * remote document. idx_unique_external_mapping was never taught about
 * tombstones, so a tombstone kept owning its external target forever: after
 * unlinking tax region DEFAULT from QBO tax code TAX, mapping region US to TAX
 * failed with "This target is already mapped to another entity" while the
 * mappings list (which hides tombstones) showed nothing to unmap
 * (alga-2026-0002886; prod raised 23505 on this index for both a fresh INSERT
 * and a tombstone-relink UPDATE).
 *
 * The index becomes partial on `deleted_at IS NULL`, so only LIVE mappings
 * reserve a target. The Xero account predicate (20261013120000) and the
 * QuickBooks Desktop account predicate (20261017150000) are carried forward
 * verbatim.
 *
 * idx_unique_alga_mapping is deliberately NOT made partial. Its key is the
 * conflict target of two upserts — KnexInvoiceMappingRepository
 * .upsertInvoiceMapping and the QuickBooks Online adapter's mapping upsert —
 * and Postgres cannot infer a PARTIAL index from `ON CONFLICT (cols)`:
 * accounting export would fail with 42P10 ("no unique or exclusion constraint
 * matching the ON CONFLICT specification"). SyncMappingLedger.insert likewise
 * relies on its 23505 to find and revive a tombstone. Keeping it total also
 * keeps the invoice relink-or-recreate semantics untouched, and it never
 * caused this ticket: one row (live or tombstoned) per Alga entity per realm
 * is still the invariant, and the create path relinks that row in place.
 *
 * Tombstone semantics are unchanged: the rows stay, nothing is purged, and the
 * invoice export path still reads them.
 *
 * Lock profile (migration-lint rule 1): the replacement is built CONCURRENTLY
 * under a staging name while the old index keeps enforcing uniqueness, the old
 * index is then dropped CONCURRENTLY, and the staging index is renamed to the
 * original name so every existing reference (23505 handling, comments, tests)
 * stays valid. Neither step blocks writes on tenant_external_entity_mappings.
 * A CONCURRENTLY build that fails leaves an INVALID index behind, which a
 * rerun would otherwise keep (IF NOT EXISTS); dropInvalidStagingIndex clears it first.
 * The new index is strictly looser than the old one, so the build cannot fail
 * on duplicates and `up` needs no dedupe.
 *
 * Citus: a plain partial index on a distributed table keyed on the
 * distribution column (tenant), so there is no colocation change.
 */

const TABLE = 'tenant_external_entity_mappings';
const INDEX_NAME = 'idx_unique_external_mapping';
const STAGING_INDEX_NAME = 'idx_unique_external_mapping_swap';

const INDEX_KEY =
  "tenant, integration_type, alga_entity_type, external_entity_id, COALESCE(external_realm_id, '')";

const XERO_PREDICATE =
  "(integration_type <> 'xero' OR COALESCE(metadata ->> 'xeroTargetKind', 'item') <> 'account')";

const DESKTOP_PREDICATE =
  "(integration_type <> 'quickbooks_desktop' OR alga_entity_type NOT IN ('service', 'discount', 'tax_code'))";

const LIVE_PREDICATE = 'deleted_at IS NULL';

/**
 * Drop a leftover INVALID build of the staging index from an interrupted run,
 * so the CONCURRENTLY + IF NOT EXISTS create below cannot silently keep it.
 * @param {import('knex').Knex} knex
 */
async function dropInvalidStagingIndex(knex) {
  const invalid = await knex.raw(
    `
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = ? AND n.nspname = current_schema() AND NOT i.indisvalid
    `,
    [STAGING_INDEX_NAME]
  );
  if (invalid.rows.length > 0) {
    await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${STAGING_INDEX_NAME}`);
  }
}

/**
 * Replace idx_unique_external_mapping with a definition using `predicate`,
 * without ever taking a write-blocking lock on the mappings table.
 * @param {import('knex').Knex} knex
 * @param {string} predicate
 */
async function swapExternalMappingIndex(knex, predicate) {
  await dropInvalidStagingIndex(knex);
  await knex.raw(`
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ${STAGING_INDEX_NAME}
    ON ${TABLE} (${INDEX_KEY})
    WHERE ${predicate}
  `);
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${INDEX_NAME}`);
  await knex.raw(`ALTER INDEX ${STAGING_INDEX_NAME} RENAME TO ${INDEX_NAME}`);
}

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  // Keep the old index enforcing uniqueness until the replacement is valid.
  // A retry after DROP but before RENAME reuses the completed replacement.
  await swapExternalMappingIndex(knex, `${XERO_PREDICATE} AND ${DESKTOP_PREDICATE} AND ${LIVE_PREDICATE}`);
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  // The old index counted tombstones, so restoring it fails on any tombstone
  // that shares a target with another row. Count those groups first and refuse
  // as a whole rather than leave an INVALID index behind.
  const dupes = await knex.raw(`
    SELECT COUNT(*)::int AS groups FROM (
      SELECT 1
      FROM ${TABLE}
      WHERE ${XERO_PREDICATE} AND ${DESKTOP_PREDICATE}
      GROUP BY ${INDEX_KEY}
      HAVING COUNT(*) > 1
    ) d
  `);
  const groups = dupes.rows[0].groups;
  if (groups > 0) {
    throw new Error(
      `Cannot restore the tombstone-including ${INDEX_NAME}: ${groups} duplicate ` +
        'target group(s) exist (unlinked mapping tombstones sharing a target with another ' +
        'mapping). Resolve those tombstone duplicates first, then re-run the rollback. ' +
        'No mappings were deleted.'
    );
  }

  await swapExternalMappingIndex(knex, `${XERO_PREDICATE} AND ${DESKTOP_PREDICATE}`);
};

// CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
exports.config = { transaction: false };
