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
 * Citus: a plain partial index on a distributed table keyed on the
 * distribution column (tenant), so there is no colocation change. The new
 * index is strictly looser than the old one, so `up` needs no dedupe.
 */

const INDEX_KEY =
  "tenant, integration_type, alga_entity_type, external_entity_id, COALESCE(external_realm_id, '')";

const XERO_PREDICATE =
  "(integration_type <> 'xero' OR COALESCE(metadata ->> 'xeroTargetKind', 'item') <> 'account')";

const DESKTOP_PREDICATE =
  "(integration_type <> 'quickbooks_desktop' OR alga_entity_type NOT IN ('service', 'discount', 'tax_code'))";

const LIVE_PREDICATE = 'deleted_at IS NULL';

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  // Both operations must permit writes while waiting for existing readers.
  // This migration runs outside a transaction to support CONCURRENTLY.
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_unique_external_mapping');
  await knex.raw(`
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_unique_external_mapping
    ON tenant_external_entity_mappings (${INDEX_KEY})
    WHERE ${XERO_PREDICATE} AND ${DESKTOP_PREDICATE} AND ${LIVE_PREDICATE}
  `);
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  // The old index counted tombstones, so restoring it fails on any tombstone
  // that shares a target with another row. Count those groups first and refuse
  // as a whole rather than drop the index and fail mid-way.
  const dupes = await knex.raw(`
    SELECT COUNT(*)::int AS groups FROM (
      SELECT 1
      FROM tenant_external_entity_mappings
      WHERE ${XERO_PREDICATE} AND ${DESKTOP_PREDICATE}
      GROUP BY ${INDEX_KEY}
      HAVING COUNT(*) > 1
    ) d
  `);
  const groups = dupes.rows[0].groups;
  if (groups > 0) {
    throw new Error(
      `Cannot restore the tombstone-including idx_unique_external_mapping: ${groups} duplicate ` +
        'target group(s) exist (unlinked mapping tombstones sharing a target with another ' +
        'mapping). Resolve those tombstone duplicates first, then re-run the rollback. ' +
        'No mappings were deleted.'
    );
  }

  await knex.raw('DROP INDEX IF EXISTS idx_unique_external_mapping');
  await knex.raw(`
    CREATE UNIQUE INDEX idx_unique_external_mapping
    ON tenant_external_entity_mappings (${INDEX_KEY})
    WHERE ${XERO_PREDICATE} AND ${DESKTOP_PREDICATE}
  `);
};

exports.config = { transaction: false };
