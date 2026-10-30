/**
 * Migration: let several tax regions map to one QuickBooks Online tax code.
 *
 * A US QuickBooks Online company on Automated Sales Tax has exactly two line
 * tax codes, TAX and NON, and the export validator tells operators to map every
 * taxable region to TAX. idx_unique_external_mapping still held QuickBooks
 * Online tax codes one-to-one, so the second taxable region was refused with
 * "This target is already mapped to another entity" (alga-2026-0002886).
 * Non-AST companies share codes the same way: one QuickBooks rate serves every
 * Alga region it applies to, exactly as QuickBooks Desktop tax codes already do
 * (20261017150000).
 *
 * QuickBooks Online tax_code rows leave the index. Services, discounts,
 * clients, payment terms and invoices stay one-to-one. The Xero account,
 * QuickBooks Desktop account and tombstone predicates (20261013120000,
 * 20261017150000, 20261027130000) are carried forward verbatim.
 *
 * Lock profile (migration-lint rule 1): same CONCURRENTLY swap as
 * 20261027130000, so writes on tenant_external_entity_mappings are never
 * blocked. The new index is strictly looser than the old one, so the build
 * cannot fail on duplicates and `up` needs no dedupe.
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

const ONLINE_TAX_CODE_PREDICATE =
  "(integration_type <> 'quickbooks_online' OR alga_entity_type <> 'tax_code')";

const LIVE_PREDICATE = 'deleted_at IS NULL';

const PREVIOUS_PREDICATE = `${XERO_PREDICATE} AND ${DESKTOP_PREDICATE} AND ${LIVE_PREDICATE}`;
const NEW_PREDICATE = `${PREVIOUS_PREDICATE} AND ${ONLINE_TAX_CODE_PREDICATE}`;

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
  await swapExternalMappingIndex(knex, NEW_PREDICATE);
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  // The previous index held QuickBooks Online tax codes one-to-one, so
  // restoring it fails wherever two live regions share a code. Count those
  // groups first and refuse as a whole rather than leave an INVALID index.
  const dupes = await knex.raw(`
    SELECT COUNT(*)::int AS groups FROM (
      SELECT 1
      FROM ${TABLE}
      WHERE ${PREVIOUS_PREDICATE}
      GROUP BY ${INDEX_KEY}
      HAVING COUNT(*) > 1
    ) d
  `);
  const groups = dupes.rows[0].groups;
  if (groups > 0) {
    throw new Error(
      `Cannot restore the one-to-one ${INDEX_NAME}: ${groups} duplicate target group(s) exist ` +
        '(QuickBooks Online tax codes shared by several tax regions). Remap them to distinct ' +
        'codes first, then re-run the rollback. No mappings were deleted.'
    );
  }

  await swapExternalMappingIndex(knex, PREVIOUS_PREDICATE);
};

// CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
exports.config = { transaction: false };
