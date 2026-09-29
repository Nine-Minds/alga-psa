import type { Knex } from 'knex';
import type { ProviderType } from './types';
import { getDisconnectRecord } from './repository';

const LOCK_NAMESPACE = 'provider_disconnect';

/**
 * Serializes provider credential writes against disconnect initiation.
 *
 * The credential storage layer checks "no active disconnect" and then writes
 * the live credential secret; disconnect initiation checks "current record
 * state" and then persists the pending record that gates every credential
 * consumer. Each of those is a check-then-act pair, so without a shared lock
 * the two can interleave: a write passes its gate, initiation then persists
 * the record and sweeps the secrets, and the write still lands afterwards —
 * live credentials that survive a disconnect reporting success. Holding this
 * lock across each pair makes them atomic with respect to one another: a
 * credential write either completes entirely before initiation observes the
 * world (and its material becomes a revocation target of the new cycle), or
 * it starts after the record exists and is refused by the gate.
 *
 * Implemented as a transaction-scoped Postgres advisory lock keyed on
 * (tenant, provider). Transaction-scoped (`pg_advisory_xact_lock`) rather than
 * session-scoped because the pool runs through PgBouncer in transaction
 * pooling mode: the lock lives and dies with the wrapping transaction, which
 * is pinned to one server connection, so there is no unlock to lose to
 * connection reuse. An advisory lock rather than a row lock because the
 * `provider_disconnect_records` row does not exist yet at the moment that
 * matters most (first initiation), and rather than an in-process mutex
 * because credential writes and disconnect initiation run in different
 * processes (web replicas, workers). `hashtext` collisions across tenants can
 * only cause spurious contention, never lost mutual exclusion.
 */
export async function withProviderCredentialLock<T>(
  knex: Knex,
  tenantId: string,
  provider: ProviderType,
  fn: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  return knex.transaction(async (trx) => {
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))', [
      `${LOCK_NAMESPACE}:${tenantId}`,
      provider,
    ]);
    return fn(trx);
  });
}

export type ProviderCredentialWriteDisposition =
  | 'allowed'
  | 'disconnect_in_progress'
  | 'stale_authorization';

/**
 * Evaluates an OAuth-originated credential write while the caller holds the
 * provider credential lock. A terminal record may only be retired by a flow
 * whose trusted server-side start time is strictly after finalization.
 */
export async function getProviderCredentialWriteDisposition(
  knex: Knex,
  tenantId: string,
  provider: ProviderType,
  authorizationFlowStartedAt?: string,
): Promise<ProviderCredentialWriteDisposition> {
  const record = await getDisconnectRecord(knex, tenantId, provider);
  if (!record) return 'allowed';
  if (record.status !== 'finalized') return 'disconnect_in_progress';

  const flowStartedAtMs = authorizationFlowStartedAt
    ? Date.parse(authorizationFlowStartedAt)
    : Number.NaN;
  const disconnectStartedAtMs = Date.parse(record.startedAt);
  const finalizedAtMs = record.finalizedAt ? Date.parse(record.finalizedAt) : Number.NaN;
  if (
    !Number.isFinite(flowStartedAtMs) ||
    !Number.isFinite(disconnectStartedAtMs) ||
    !Number.isFinite(finalizedAtMs) ||
    flowStartedAtMs <= disconnectStartedAtMs ||
    flowStartedAtMs <= finalizedAtMs
  ) {
    return 'stale_authorization';
  }
  return 'allowed';
}
