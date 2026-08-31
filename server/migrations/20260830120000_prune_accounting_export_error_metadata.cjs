/**
 * Accounting export error metadata now stores allowlisted diagnostics only
 * (adapter type, stable code, document ID, correlation ID, validation
 * messages). Historical rows can still carry raw provider payloads under
 * `metadata.raw` / `metadata.originalError`; strip those keys in place.
 *
 * Forward-only: the discarded payload data is intentionally unrecoverable.
 * Tenant-scoped batches keep every UPDATE routable to a single shard on
 * Citus and keep transaction sizes bounded on large installs.
 */

const BATCH_SIZE = 500;
const PRUNED_KEYS_PREDICATE = "metadata ?| array['raw', 'originalError']";

exports.up = async function up(knex) {
  const tenants = await knex('accounting_export_errors')
    .whereRaw(PRUNED_KEYS_PREDICATE)
    .distinct('tenant')
    .pluck('tenant');

  for (const tenant of tenants) {
    // Bounded loop: each pass prunes at most BATCH_SIZE rows for one tenant.
    for (;;) {
      const errorIds = await knex('accounting_export_errors')
        .where({ tenant })
        .whereRaw(PRUNED_KEYS_PREDICATE)
        .limit(BATCH_SIZE)
        .pluck('error_id');

      if (errorIds.length === 0) {
        break;
      }

      await knex('accounting_export_errors')
        .where({ tenant })
        .whereIn('error_id', errorIds)
        .update({
          metadata: knex.raw("(metadata - 'raw') - 'originalError'")
        });
    }
  }
};

exports.down = async function down() {
  // Forward-only: raw provider payloads are removed permanently by design.
};
