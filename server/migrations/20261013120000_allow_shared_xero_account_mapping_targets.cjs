/**
 * Migration: let Xero revenue-account targets be shared.
 *
 * idx_unique_external_mapping becomes a PARTIAL unique index. Xero rows whose
 * metadata.xeroTargetKind is 'account' are excluded, so many services (and the
 * discount mapping) may map to one revenue account, and an item and an account
 * may share a code. Item rows (kind 'item' or absent = legacy) stay one-to-one,
 * as does every other integration.
 *
 * The predicate uses COALESCE so it is TRUE (never NULL) for rows with NULL
 * metadata or a missing key; a NULL predicate would drop those rows from the
 * index. The new index is looser than the old one, so `up` needs no dedupe.
 */

const INDEX_KEY =
  "tenant, integration_type, alga_entity_type, external_entity_id, COALESCE(external_realm_id, '')";

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_unique_external_mapping');
  await knex.raw(`
    CREATE UNIQUE INDEX idx_unique_external_mapping
    ON tenant_external_entity_mappings (${INDEX_KEY})
    WHERE integration_type <> 'xero'
       OR COALESCE(metadata ->> 'xeroTargetKind', 'item') <> 'account'
  `);
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  const dupes = await knex.raw(`
    SELECT COUNT(*)::int AS groups FROM (
      SELECT 1
      FROM tenant_external_entity_mappings
      GROUP BY ${INDEX_KEY}
      HAVING COUNT(*) > 1
    ) d
  `);
  const groups = dupes.rows[0].groups;
  if (groups > 0) {
    throw new Error(
      `Cannot restore the full idx_unique_external_mapping: ${groups} duplicate target group(s) exist ` +
        '(Xero revenue accounts shared by several services). Remap the shared-account services ' +
        'to distinct targets first, then re-run the rollback. No mappings were deleted.'
    );
  }

  await knex.raw('DROP INDEX IF EXISTS idx_unique_external_mapping');

  const citus = await knex.raw(
    "SELECT to_regclass('pg_catalog.pg_dist_partition') IS NOT NULL AS has_citus"
  );
  if (citus.rows[0].has_citus) {
    const distributed = await knex.raw(
      "SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'public.tenant_external_entity_mappings'::regclass"
    );
    if (distributed.rows.length > 0) {
      await knex.raw(
        "SELECT truncate_local_data_after_distributing_table('public.tenant_external_entity_mappings')"
      );
    }
  }

  await knex.raw(`
    CREATE UNIQUE INDEX idx_unique_external_mapping
    ON tenant_external_entity_mappings (${INDEX_KEY})
  `);
};

exports.config = { transaction: true };
