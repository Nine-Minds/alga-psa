/**
 * Migration: enforce one pending accounting sync operation per target realm.
 *
 * The repository deduplicates enqueues on tenant + adapter + operation +
 * entity + target realm. This backs that contract with a partial unique
 * index, so concurrent enqueues cannot create ambiguous duplicate pending
 * work, and the same local entity queued against two different realms stays
 * two distinct operations.
 *
 * Before creating the index, duplicate pending rows (same identity, realm
 * included) are collapsed: the earliest keeps running, later ones are retired
 * as 'skipped' with an explanatory error.
 */

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  // ── 1. Collapse existing duplicate pending ops (keep the earliest) ───────
  await knex.raw(`
    UPDATE accounting_sync_operations o
    SET status = 'skipped',
        processed_at = now(),
        last_error = 'Duplicate pending operation superseded by an earlier queue entry for the same target realm'
    WHERE o.status = 'pending'
      AND EXISTS (
        SELECT 1
        FROM accounting_sync_operations k
        WHERE k.tenant = o.tenant
          AND k.adapter_type = o.adapter_type
          AND k.operation = o.operation
          AND k.alga_entity_type = o.alga_entity_type
          AND k.alga_entity_id = o.alga_entity_id
          AND COALESCE(k.target_realm, '') = COALESCE(o.target_realm, '')
          AND k.status = 'pending'
          AND (k.created_at < o.created_at
               OR (k.created_at = o.created_at AND k.op_id < o.op_id))
      )
  `);

  // ── 2. Enforce uniqueness of pending work per realm ──────────────────────
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS accounting_sync_operations_pending_unique
    ON accounting_sync_operations (
      tenant, adapter_type, operation, alga_entity_type, alga_entity_id,
      COALESCE(target_realm, '')
    )
    WHERE status = 'pending'
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  // Retired duplicates are not resurrected — skipping them is a fact.
  await knex.raw('DROP INDEX IF EXISTS accounting_sync_operations_pending_unique');
};

exports.config = { transaction: false };
