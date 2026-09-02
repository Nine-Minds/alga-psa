/**
 * Migration: make QuickBooks Online mapping rows realm-exact.
 *
 * QBO entity ids are company (realm) local, so a mapping row is only usable by
 * operations targeting the same realm. Repository lookups are now realm-exact
 * and no longer fall back to null-realm rows, so legacy rows without a realm
 * must be resolved here rather than guessed at write time.
 *
 * A legacy null-realm row carries no record of which company it was synced
 * against. The realm a tenant currently happens to have mappings for is NOT
 * proof of ownership: a tenant that today shows a single non-null realm may
 * have switched its default company, disconnected an earlier one, or is only
 * mid-migration — stamping the null rows with "the one realm we can see" would
 * silently retarget records the moment the observed realm changes. There is no
 * deterministic, change-proof way to infer the owner, so we do not infer it.
 *
 * 1. Quarantine: EVERY null-realm QBO mapping row is marked
 *    sync_status 'needs_realm_review', unconditionally and regardless of how
 *    many realms the tenant currently shows. The row keeps its null realm, so
 *    realm-exact lookups never consume it and no remote write can touch it;
 *    reconciliation is a deliberate manual step decoupled from default-realm
 *    changes. This is deterministic: the same legacy rows are quarantined
 *    identically whether the tenant later has one, zero, or several realms.
 * 2. Queued operations: any null-realm pending/in-progress QBO op is retired
 *    as 'skipped' with an explanatory error rather than guessed onto a realm.
 *    Re-queueing after reconciliation stamps the correct realm at enqueue time.
 * 3. The per-local-entity uniqueness index is widened to include the realm, so
 *    the same local record may map into different companies but never twice
 *    into the same one. (The previous realm-less unique constraint was
 *    strictly stronger, so no dedupe is needed before creating the new index.)
 *
 * Other integration types store external_realm_id semantics of their own
 * (often null); steps 1-2 are scoped to 'quickbooks_online' only.
 */

const QBO = 'quickbooks_online';

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  // ── 1. Quarantine every null-realm mapping row (never guess the owner) ────
  // We do not stamp a realm inferred from currently-observed mappings: that is
  // a guess that a later default-realm change would silently invalidate. All
  // null-realm rows are quarantined deterministically and keep their null realm
  // so realm-exact lookups skip them until a human reconciles.
  await knex.raw(
    `
    UPDATE tenant_external_entity_mappings
    SET sync_status = 'needs_realm_review',
        metadata = COALESCE(metadata, '{}'::jsonb) || '{"realm_review_reason": "legacy mapping has no realm; the owning company cannot be proven and must be reconciled manually"}'::jsonb
    WHERE integration_type = ?
      AND external_realm_id IS NULL
    `,
    [QBO]
  );

  // ── 2. Retire null-realm queued operations (never guess the target) ──────
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

  // ── 3. Widen local-entity uniqueness to include the realm ────────────────
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
  // Quarantine is not reversed — a legacy row's realm still cannot be proven,
  // so 'needs_realm_review' remains the honest state. Restore the narrower
  // uniqueness only (may fail if per-realm duplicates were created while the
  // wider index was live; resolve those first).
  await knex.raw('DROP INDEX IF EXISTS idx_unique_alga_mapping');
  await knex.raw(`
    CREATE UNIQUE INDEX idx_unique_alga_mapping
    ON tenant_external_entity_mappings (tenant, integration_type, alga_entity_type, alga_entity_id)
  `);
};

exports.config = { transaction: false };
