/**
 * Migration: make QuickBooks Online mapping rows realm-exact.
 *
 * QBO entity ids are company (realm) local, so a mapping row is only usable by
 * operations targeting the same realm. Repository lookups are now realm-exact
 * and no longer fall back to null-realm rows, so legacy rows must be resolved
 * here rather than guessed at write time:
 *
 * 1. Backfill: a tenant whose QBO mappings reference exactly one non-null
 *    realm has provably only ever synced with that company — its null-realm
 *    rows are stamped with that realm.
 * 2. Quarantine: remaining null-realm QBO rows (tenant has zero or multiple
 *    known realms) get sync_status 'needs_realm_review'. They keep a null
 *    realm, so realm-exact lookups never consume them; reconciliation is a
 *    deliberate manual step.
 * 3. Queued operations get the same treatment: null-realm pending/in-progress
 *    QBO ops are backfilled when the tenant's realm is unambiguous, otherwise
 *    retired as 'skipped' with an explanatory error.
 * 4. The per-local-entity uniqueness index is widened to include the realm, so
 *    the same local record may map into different companies but never twice
 *    into the same one. (The previous realm-less unique constraint was
 *    strictly stronger, so no dedupe is needed before creating the new index.)
 *
 * Other integration types store external_realm_id semantics of their own
 * (often null); steps 1-3 are scoped to 'quickbooks_online' only.
 */

const QBO = 'quickbooks_online';

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  // ── 1. Backfill null-realm mapping rows for single-realm tenants ─────────
  await knex.raw(
    `
    WITH single_realm AS (
      SELECT tenant, MIN(external_realm_id) AS realm_id
      FROM tenant_external_entity_mappings
      WHERE integration_type = ?
      GROUP BY tenant
      HAVING COUNT(DISTINCT external_realm_id) = 1
    )
    UPDATE tenant_external_entity_mappings m
    SET external_realm_id = s.realm_id,
        metadata = COALESCE(m.metadata, '{}'::jsonb) || '{"realm_backfilled": true}'::jsonb
    FROM single_realm s
    WHERE m.tenant = s.tenant
      AND m.integration_type = ?
      AND m.external_realm_id IS NULL
    `,
    [QBO, QBO]
  );

  // ── 2. Quarantine mapping rows whose realm cannot be proven ──────────────
  await knex.raw(
    `
    UPDATE tenant_external_entity_mappings
    SET sync_status = 'needs_realm_review',
        metadata = COALESCE(metadata, '{}'::jsonb) || '{"realm_review_reason": "legacy mapping has no realm and the owning company could not be determined"}'::jsonb
    WHERE integration_type = ?
      AND external_realm_id IS NULL
    `,
    [QBO]
  );

  // ── 3. Resolve null-realm queued operations the same way ─────────────────
  await knex.raw(
    `
    WITH single_realm AS (
      SELECT tenant, MIN(external_realm_id) AS realm_id
      FROM tenant_external_entity_mappings
      WHERE integration_type = ?
      GROUP BY tenant
      HAVING COUNT(DISTINCT external_realm_id) = 1
    )
    UPDATE accounting_sync_operations o
    SET target_realm = s.realm_id
    FROM single_realm s
    WHERE o.tenant = s.tenant
      AND o.adapter_type = ?
      AND o.target_realm IS NULL
    `,
    [QBO, QBO]
  );

  await knex.raw(
    `
    UPDATE accounting_sync_operations
    SET status = 'skipped',
        processed_at = now(),
        last_error = 'Operation had no target realm and the owning QuickBooks company could not be determined; re-queue it after reviewing the record''s mapping'
    WHERE adapter_type = ?
      AND target_realm IS NULL
      AND status IN ('pending', 'in_progress')
    `,
    [QBO]
  );

  // ── 4. Widen local-entity uniqueness to include the realm ────────────────
  await knex.raw(
    'ALTER TABLE tenant_external_entity_mappings DROP CONSTRAINT IF EXISTS idx_unique_alga_mapping'
  );
  await knex.raw('DROP INDEX IF EXISTS idx_unique_alga_mapping');
  await knex.raw(`
    CREATE UNIQUE INDEX idx_unique_alga_mapping
    ON tenant_external_entity_mappings (tenant, integration_type, alga_entity_type, alga_entity_id, COALESCE(external_realm_id, ''))
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  // Realm backfill/quarantine is not reversed — the stamped realms are facts.
  // Restore the narrower uniqueness only (may fail if per-realm duplicates
  // were created while the wider index was live; resolve those first).
  await knex.raw('DROP INDEX IF EXISTS idx_unique_alga_mapping');
  await knex.raw(`
    CREATE UNIQUE INDEX idx_unique_alga_mapping
    ON tenant_external_entity_mappings (tenant, integration_type, alga_entity_type, alga_entity_id)
  `);
};

exports.config = { transaction: false };
