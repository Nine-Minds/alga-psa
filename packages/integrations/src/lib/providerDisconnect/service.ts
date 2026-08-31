import type { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { notifyQboConnectionChanged } from '../qbo/qboConnectionChangeProvider';
import { getDisconnectRecord, createDisconnectRecord, deleteDisconnectRecord, updateTargetOutcome, setRecordStatus, replaceDisconnectTargets } from './repository';
import { withProviderCredentialLock } from './lock';
import { writeDisconnectAudit, writeDisconnectAuditInTransaction } from './audit';
import {
  tombstoneLiveCredentials,
  clearTombstoneCredentials,
  clearTombstoneCredentialsStrict,
  tombstoneCredentialsSecretName,
  hasAnyProviderCredentials,
  hasLiveProviderCredentials,
  type SecretProviderLike,
} from './tombstone';
import {
  revokeQboRealm,
  revokeXeroConnection,
  revokeXeroGrant,
  readQboRevokeMaterial,
  readXeroRevokeMaterial,
  toXeroRevokeMaterial,
  type RevokeResult,
} from './revoker';
import {
  XERO_GRANT_TARGET_ID,
  PROVIDER_QBO,
  PROVIDER_XERO,
  type DisconnectTargetEntry,
  type ProviderDisconnectRecord,
  type ProviderType,
} from './types';

export interface DisconnectServiceOptions {
  userId?: string | null;
  /** True when invoked from the scheduled retry job rather than a user action. */
  fromRetry?: boolean;
}

export type DisconnectServiceStatus =
  | 'disconnected'
  | 'already_disconnected'
  | 'pending'
  | 'partial'
  | 'failed_permanent'
  | 'no_credentials';

export interface DisconnectServiceResult {
  status: DisconnectServiceStatus;
  record: ProviderDisconnectRecord | null;
  error?: string;
}

export interface ForceFinalizeOptions {
  userId?: string | null;
  reason: string;
}

const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 60 * 60 * 1000;

/**
 * Bounded retry budget for transient provider failures. 20 attempts with the
 * exponential backoff capped at 1h keeps retrying for well over a day before
 * the disconnect surfaces an operator-actionable terminal state. Chosen over
 * retrying indefinitely: the work order requires a visible terminal path for
 * "retry budget exhaustion or a definitive permanent error", and permanently
 * relaxing the force-finalize guard while the record still reads "pending"
 * would hide the reason behind a status that claims retrying continues.
 */
export const MAX_RETRY_ATTEMPTS = 20;

function computeNextRetryAt(attemptCount: number): string {
  const delay = Math.min(RETRY_BASE_MS * 2 ** Math.min(attemptCount, 6), RETRY_MAX_MS);
  return new Date(Date.now() + delay).toISOString();
}

async function generateCorrelationId(): Promise<string> {
  const { randomUUID } = await import('node:crypto');
  return randomUUID();
}

/**
 * Disconnect a provider for a tenant: tombstone credentials immediately, then
 * drive provider-side cleanup (per-target) to provider-confirmed completion.
 * Idempotent — a pending record resumes; a finalized record is a no-op only
 * while no live credentials exist, and otherwise starts a fresh cycle over the
 * current live credentials.
 */
export async function disconnectProvider(
  knex: Knex,
  tenantId: string,
  provider: ProviderType,
  opts: DisconnectServiceOptions = {},
): Promise<DisconnectServiceResult> {
  const secretProvider = (await getSecretProviderInstance()) as unknown as SecretProviderLike;

  // Initiation runs under the shared credential-write lock (see lock.ts):
  // observing the current record/credential state and persisting the pending
  // record must be atomic with respect to the credential storage layer, whose
  // own check-and-write holds the same lock. A credential write therefore
  // either completes before this section reads the material (and becomes a
  // revocation target of the cycle it starts), or begins after the record
  // exists and is refused by the storage gate — it can never land between the
  // gate check and the tombstone sweep. Only initiation is locked; the
  // revocation pass below runs outside it because once the record exists the
  // gate holds on its own, and provider HTTP calls must not extend a database
  // transaction.
  interface InitiationOutcome {
    earlyResult?: DisconnectServiceResult;
    record?: ProviderDisconnectRecord;
  }
  const initiation = await withProviderCredentialLock<InitiationOutcome>(knex, tenantId, provider, async (trx) => {
    let existing = await getDisconnectRecord(trx, tenantId, provider);

    // A terminal record (finalized, or failed_permanent pre-force-finalize) is
    // only a true "already disconnected" when no live credentials exist: if live
    // credentials are present alongside the record, the tenant reconnected after
    // the prior cycle and the record is stale. Leaving it in place would either
    // short-circuit the next disconnect into a silent no-op (`finalized`) or an
    // operator dead-end (`failed_permanent`) while the live connection stays
    // reachable — exactly the lifecycle defect this card fixes. The row is keyed
    // by (tenant, provider), so the stale row is retired (deleted) and the
    // first-disconnect path below builds a brand-new cycle: targets computed from
    // the current live credentials, a fresh correlation id, attempt counts
    // reset, and the live credentials tombstoned immediately. This is defense in
    // depth: the OAuth reconnect paths retire terminal records at credential
    // storage time, but the service must not depend on that cleanup having run.
    if (existing && (existing.status === 'finalized' || existing.status === 'failed_permanent')) {
      const hasLive = await hasLiveProviderCredentials(tenantId, provider, secretProvider);
      if (hasLive) {
        logger.warn('[providerDisconnect] Starting a fresh disconnect cycle over live credentials after a terminal record', {
          tenantId,
          provider,
          staleStatus: existing.status,
          staleCorrelationId: existing.correlationId,
        });
        // Clear any orphaned tombstone material first so the fresh cycle reads
        // (and tombstones) the current live credentials as its authoritative
        // target material.
        await clearTombstoneCredentials(tenantId, provider, secretProvider);
        await deleteDisconnectRecord(trx, tenantId, provider);
        existing = null;
      } else if (existing.status === 'finalized') {
        // No live credentials: a finalized record is a stable no-op. Finalization
        // normally clears the tombstone too; clear it if it ever survived so the
        // record truly reflects "nothing anywhere".
        await clearTombstoneCredentials(tenantId, provider, secretProvider);
        return { earlyResult: { status: 'already_disconnected' as const, record: existing } };
      }
      // `failed_permanent` with no live credentials falls through to the
      // operator-actionable short-circuit below — an un-finalized operator state
      // is not silently swallowed.
    }

    const tombstoneSecretName = tombstoneCredentialsSecretName(provider);
    const material = provider === PROVIDER_QBO
      ? await readQboRevokeMaterial(tenantId, secretProvider, tombstoneSecretName)
      : await readXeroRevokeMaterial(tenantId, secretProvider, tombstoneSecretName);
    const hasMaterial = Object.keys(material).length > 0;

    let record = existing;
    if (!record) {
      if (!hasMaterial && !(await hasAnyProviderCredentials(tenantId, provider, secretProvider))) {
        // Nothing connected and nothing tombstoned: record a finalized marker so
        // repeat disconnect calls are stable no-ops with an audit trail.
        const correlationId = await generateCorrelationId();
        record = await createDisconnectRecord(trx, {
          tenantId,
          provider,
          targets: [],
          correlationId,
        });
        await setRecordStatus(trx, tenantId, provider, 'finalized', {
          finalizedAt: new Date().toISOString(),
        });
        await writeDisconnectAudit({
          knex: trx,
          tenantId,
          provider,
          operation: 'disconnect_finalized',
          targetId: null,
          result: 'no_credentials',
          correlationId,
          userId: opts.userId,
        });
        return { earlyResult: { status: 'no_credentials' as const, record } };
      }

      // First disconnect: persist the durable pending record before touching any
      // secret, so a failure between the database write and the credential
      // tombstoning can never strand moved credentials without a retry-drivable
      // record. From the moment this row exists the disconnect gates
      // (isProviderDisconnectActive) hold, so the brief not-yet-tombstoned
      // window admits no new syncs, exports, or reconnects; the revocation pass
      // below performs — and after a crash, repeats — the tombstone move as its
      // first step.
      const correlationId = await generateCorrelationId();
      const targetIds = Object.keys(material);
      record = await createDisconnectRecord(trx, {
        tenantId,
        provider,
        targets: targetIds.map((targetId) => ({ targetId })),
        correlationId,
      });

      await writeDisconnectAudit({
        knex: trx,
        tenantId,
        provider,
        operation: 'disconnect_started',
        targetId: null,
        result: 'pending',
        attemptCount: 0,
        correlationId,
        userId: opts.userId,
      });
    }

    return { record };
  });

  if (initiation.earlyResult) {
    return initiation.earlyResult;
  }
  const record = initiation.record!;

  if (record.status === 'failed_permanent') {
    // Nothing retryable remains; the operator must force-finalize.
    return {
      status: 'failed_permanent',
      record,
      error: 'Provider cleanup ended in a permanent error. Finalize the disconnect manually to finish.',
    };
  }

  const result = await runRevocationPass(knex, tenantId, provider, record, secretProvider, opts);
  const latest = (await getDisconnectRecord(knex, tenantId, provider)) ?? record;

  if (result.status === 'failed_permanent') {
    return { status: 'failed_permanent', record: latest, error: result.error };
  }

  if (result.status === 'disconnected') {
    return { status: 'disconnected', record: latest };
  }

  return {
    status: result.status,
    record: latest,
    error: result.error,
  };
}

interface RevocationPassResult {
  status: 'disconnected' | 'pending' | 'partial' | 'failed_permanent';
  error?: string;
  transientTargets: number;
  permanentTargets: number;
}

interface PassCounters {
  transientTargets: number;
  permanentTargets: number;
  revokedTargets: number;
  firstTransientErrorClass: string | null;
  firstPermanentErrorClass: string | null;
}

/**
 * Revokes one target and persists its outcome + audit row. Shared by the
 * per-target loop and the Xero grant step so both record results identically.
 */
async function revokeAndRecordTarget(
  knex: Knex,
  tenantId: string,
  provider: ProviderType,
  target: DisconnectTargetEntry,
  material: Record<string, unknown>,
  record: ProviderDisconnectRecord,
  opts: DisconnectServiceOptions,
  counters: PassCounters,
): Promise<void> {
  const outcome = await revokeSingleTarget(knex, tenantId, provider, target, material);
  switch (outcome.outcome) {
    case 'revoked':
      counters.revokedTargets += 1;
      await updateTargetOutcome(knex, tenantId, provider, target.targetId, {
        status: 'revoked',
        errorClass: null,
      });
      await writeDisconnectAudit({
        knex,
        tenantId,
        provider,
        operation: 'disconnect_target_revoked',
        targetId: target.targetId,
        result: 'revoked',
        attemptCount: record.attemptCount + 1,
        correlationId: record.correlationId,
        userId: opts.userId,
      });
      break;
    case 'transient_failure':
      counters.transientTargets += 1;
      if (!counters.firstTransientErrorClass) counters.firstTransientErrorClass = outcome.errorClass;
      await updateTargetOutcome(knex, tenantId, provider, target.targetId, {
        status: 'pending_revocation',
        errorClass: outcome.errorClass,
      });
      await writeDisconnectAudit({
        knex,
        tenantId,
        provider,
        operation: 'disconnect_target_failed',
        targetId: target.targetId,
        result: 'transient_failure',
        attemptCount: record.attemptCount + 1,
        correlationId: record.correlationId,
        userId: opts.userId,
      });
      break;
    case 'permanent_failure':
      counters.permanentTargets += 1;
      if (!counters.firstPermanentErrorClass) counters.firstPermanentErrorClass = outcome.errorClass;
      await updateTargetOutcome(knex, tenantId, provider, target.targetId, {
        status: 'failed_permanent',
        errorClass: outcome.errorClass,
      });
      await writeDisconnectAudit({
        knex,
        tenantId,
        provider,
        operation: 'disconnect_target_failed',
        targetId: target.targetId,
        result: 'permanent_failure',
        attemptCount: record.attemptCount + 1,
        correlationId: record.correlationId,
        userId: opts.userId,
      });
      break;
  }
}

/**
 * True when every Xero tenant-connection target is revoked (the condition under
 * which the OAuth grant must be revoked: the last tenant connection is gone).
 */
function xeroGrantDue(targets: DisconnectTargetEntry[]): boolean {
  const connections = targets.filter((target) => target.targetId !== XERO_GRANT_TARGET_ID);
  if (connections.length === 0) return false;
  return connections.every((target) => target.status === 'revoked');
}

async function runRevocationPass(
  knex: Knex,
  tenantId: string,
  provider: ProviderType,
  record: ProviderDisconnectRecord,
  secretProvider: SecretProviderLike,
  opts: DisconnectServiceOptions,
): Promise<RevocationPassResult> {
  const tombstoneSecretName = tombstoneCredentialsSecretName(provider);
  const attemptCount = record.attemptCount;

  // Complete (or repeat) the initiation's credential tombstoning: the durable
  // record is persisted before any secret is touched, so a crash between the
  // two operations leaves live credentials alongside a pending record. Every
  // pass — user repeat or the scheduled retry job — re-drives this move until
  // it sticks. Idempotent: existing tombstone material wins, and with nothing
  // live it is a no-op. A secret-store failure here propagates, leaving the
  // record pending (and due) for the next pass.
  const moved = await tombstoneLiveCredentials(tenantId, provider, secretProvider);

  const material = provider === PROVIDER_QBO
    ? await readQboRevokeMaterial(tenantId, secretProvider, tombstoneSecretName)
    : await readXeroRevokeMaterial(tenantId, secretProvider, tombstoneSecretName);

  if (!moved.movedValue && Object.keys(material).length > 0) {
    // Defensive: material was readable (e.g. a non-string live secret the
    // move does not handle) but nothing landed under the tombstone name —
    // write it there directly so finalization's strict deletion covers it.
    await secretProvider.setTenantSecret(tenantId, tombstoneSecretName, JSON.stringify(material));
  }

  const counters: PassCounters = {
    transientTargets: 0,
    permanentTargets: 0,
    revokedTargets: 0,
    firstTransientErrorClass: null,
    firstPermanentErrorClass: null,
  };

  // Retry-budget exhaustion: once the bounded budget is spent, stop calling
  // the provider and surface an operator-actionable terminal state instead of
  // retrying forever. Still-pending targets are recorded as permanently failed
  // so the existing force-finalize path becomes available.
  if (record.attemptCount >= MAX_RETRY_ATTEMPTS) {
    await exhaustRetryBudget(knex, tenantId, provider, record, opts);
    return {
      status: 'failed_permanent',
      transientTargets: 0,
      permanentTargets: 1,
      error: 'Provider cleanup kept failing and the retry budget is exhausted. An admin must finalize the disconnect manually.',
    };
  }

  // Process pending targets, looping once more when revoking the last Xero
  // connection introduces the OAuth-grant target. The loop is bounded: the
  // grant target can only be introduced once, so at most one extra iteration
  // runs before every target has a terminal (or re-pending) status.
  let targets = record.targets;
  while (true) {
    const pending = targets.filter((target) => target.status === 'pending_revocation');
    if (pending.length === 0) break;

    for (const target of pending) {
      await revokeAndRecordTarget(knex, tenantId, provider, target, material, record, opts, counters);
    }

    const latestTargets = (await getDisconnectRecord(knex, tenantId, provider))?.targets ?? targets;

    // Xero: once every connection is revoked, revoke the OAuth grant too. The
    // work order requires grant revocation once no connections remain, and it
    // must run in the same pass so a single disconnect converges.
    if (provider === PROVIDER_XERO && xeroGrantDue(latestTargets)) {
      const hasGrant = latestTargets.some((target) => target.targetId === XERO_GRANT_TARGET_ID);
      if (!hasGrant) {
        const now = new Date().toISOString();
        const withGrant: DisconnectTargetEntry[] = [
          ...latestTargets,
          { targetId: XERO_GRANT_TARGET_ID, status: 'pending_revocation', updatedAt: now },
        ];
        await replaceDisconnectTargets(knex, tenantId, provider, withGrant);
        targets = withGrant;
        continue;
      }
    }

    targets = latestTargets;
    break;
  }

  const latest = (await getDisconnectRecord(knex, tenantId, provider)) ?? record;
  const remainingPending = latest.targets.filter(
    (target) => target.status === 'pending_revocation',
  ).length;
  const remainingPermanent = latest.targets.filter(
    (target) => target.status === 'failed_permanent',
  ).length;

  if (remainingPending === 0 && remainingPermanent === 0) {
    // Provider cleanup confirmed for every target — finalize local deletion.
    // Atomic-in-effect: the record only transitions to `finalized` after the
    // tombstoned credential secret is actually deleted. A deletion failure
    // leaves the record retryable (targets already `revoked` stay `revoked`,
    // so the retry pass re-runs only the local-cleanup step) and emits a
    // sanitized audit event; `finalized` must always mean the encrypted
    // credential material is gone.
    try {
      await clearTombstoneCredentialsStrict(tenantId, provider, secretProvider);
    } catch (error) {
      const nextAttempt = attemptCount + 1;
      await setRecordStatus(knex, tenantId, provider, 'pending_revocation', {
        attemptCount: nextAttempt,
        nextRetryAt: computeNextRetryAt(nextAttempt),
        lastErrorClass: 'credential_secret_deletion_failed',
      });
      await writeDisconnectAudit({
        knex,
        tenantId,
        provider,
        operation: 'disconnect_cleanup_failed',
        targetId: null,
        result: 'credential_deletion_failed',
        attemptCount: nextAttempt,
        correlationId: latest.correlationId,
        userId: opts.userId,
      });
      logger.error(
        '[providerDisconnect] Finalization blocked: tombstone credential deletion failed; local cleanup will retry',
        {
          tenantId,
          provider,
          correlationId: latest.correlationId,
          attemptCount: nextAttempt,
          error: error instanceof Error ? error.message : error,
        },
      );
      return {
        status: 'partial',
        transientTargets: counters.transientTargets,
        permanentTargets: counters.permanentTargets,
        error: 'Provider cleanup is complete, but local credential removal failed. The disconnect will retry the local cleanup.',
      };
    }
    await setRecordStatus(knex, tenantId, provider, 'finalized', {
      attemptCount: attemptCount + 1,
      nextRetryAt: null,
      lastErrorClass: null,
      finalizedAt: new Date().toISOString(),
    });
    await writeDisconnectAudit({
      knex,
      tenantId,
      provider,
      operation: 'disconnect_finalized',
      targetId: null,
      result: 'revoked',
      attemptCount: attemptCount + 1,
      correlationId: latest.correlationId,
      userId: opts.userId,
    });
    if (provider === PROVIDER_QBO) {
      await notifyQboConnectionChanged(tenantId);
    }
    return { status: 'disconnected', transientTargets: counters.transientTargets, permanentTargets: counters.permanentTargets };
  }

  if (remainingPending > 0) {
    // Transient failure: stay retryable with bounded backoff.
    const nextAttempt = attemptCount + 1;
    await setRecordStatus(knex, tenantId, provider, 'pending_revocation', {
      attemptCount: nextAttempt,
      nextRetryAt: computeNextRetryAt(nextAttempt),
      lastErrorClass: counters.firstTransientErrorClass,
    });
    await writeDisconnectAudit({
      knex,
      tenantId,
      provider,
      operation: 'disconnect_retry_started',
      targetId: null,
      result: 'pending',
      attemptCount: nextAttempt,
      correlationId: latest.correlationId,
      userId: opts.userId,
    });
    const isPartial = counters.permanentTargets > 0 || counters.revokedTargets > 0;
    return {
      status: isPartial ? 'partial' : 'pending',
      transientTargets: counters.transientTargets,
      permanentTargets: counters.permanentTargets,
      error: 'Provider cleanup is not complete yet. The disconnect will keep retrying.',
    };
  }

  // All remaining targets failed permanently — operator action required.
  await setRecordStatus(knex, tenantId, provider, 'failed_permanent', {
    attemptCount: attemptCount + 1,
    nextRetryAt: null,
    lastErrorClass: counters.firstPermanentErrorClass,
  });
  return {
    status: 'failed_permanent',
    transientTargets: counters.transientTargets,
    permanentTargets: counters.permanentTargets,
    error: 'Provider cleanup hit a permanent error. An admin must finalize the disconnect manually.',
  };
}

/**
 * Terminal transition for retry-budget exhaustion. Marks any still-pending
 * targets as permanently failed (preserving their last error class), records
 * the record as `failed_permanent`, and emits one audit event for the
 * crossing. Runs without any further provider call; the operator's
 * force-finalize is then the only path to local deletion.
 */
async function exhaustRetryBudget(
  knex: Knex,
  tenantId: string,
  provider: ProviderType,
  record: ProviderDisconnectRecord,
  opts: DisconnectServiceOptions,
): Promise<void> {
  const now = new Date().toISOString();
  const targets: DisconnectTargetEntry[] = record.targets.map((target) =>
    target.status === 'pending_revocation'
      ? {
          ...target,
          status: 'failed_permanent',
          errorClass: target.errorClass ?? 'retry_budget_exhausted',
          updatedAt: now,
        }
      : target,
  );
  await replaceDisconnectTargets(knex, tenantId, provider, targets);
  await setRecordStatus(knex, tenantId, provider, 'failed_permanent', {
    attemptCount: record.attemptCount + 1,
    nextRetryAt: null,
    lastErrorClass: 'retry_budget_exhausted',
  });
  await writeDisconnectAudit({
    knex,
    tenantId,
    provider,
    operation: 'disconnect_retry_budget_exhausted',
    targetId: null,
    result: 'retry_budget_exhausted',
    attemptCount: record.attemptCount + 1,
    correlationId: record.correlationId,
    userId: opts.userId,
  });
}

async function revokeSingleTarget(
  knex: Knex,
  tenantId: string,
  provider: ProviderType,
  target: DisconnectTargetEntry,
  material: Record<string, unknown>,
): Promise<RevokeResult> {
  if (provider === PROVIDER_QBO) {
    const qboMaterial = material as Record<string, { realmId: string; refreshToken: string }>;
    const entry = qboMaterial[target.targetId];
    if (!entry?.refreshToken) {
      return { outcome: 'permanent_failure', errorClass: 'quickbooks_online_no_credential_material' };
    }
    return revokeQboRealm(tenantId, { realmId: entry.realmId, refreshToken: entry.refreshToken });
  }

  // Xero
  if (target.targetId === XERO_GRANT_TARGET_ID) {
    const xeroMaterial = material as Record<string, { refreshToken: string }>;
    const firstConnection = Object.values(xeroMaterial)[0];
    if (!firstConnection?.refreshToken) {
      return { outcome: 'permanent_failure', errorClass: 'xero_no_credential_material' };
    }
    return revokeXeroGrant(tenantId, firstConnection.refreshToken);
  }

  const xeroMaterial = material as Record<string, {
    connectionId: string;
    accessToken: string;
    accessTokenExpiresAt: string;
    refreshToken: string;
    refreshTokenExpiresAt?: string;
  }>;
  const entry = xeroMaterial[target.targetId];
  if (!entry) {
    return { outcome: 'permanent_failure', errorClass: 'xero_no_credential_material' };
  }
  return revokeXeroConnection(tenantId, toXeroRevokeMaterial(entry));
}

/**
 * Operator force-finalize for permanent provider errors. Only valid once no
 * target remains retryable (all revoked or permanently failed). Deletes the
 * tombstoned credentials and marks the record finalized with the operator's
 * reason. This terminal path is a deliberate, audited operator action.
 */
export async function forceFinalizeProviderDisconnect(
  knex: Knex,
  tenantId: string,
  provider: ProviderType,
  opts: ForceFinalizeOptions,
): Promise<DisconnectServiceResult> {
  const secretProvider = (await getSecretProviderInstance()) as unknown as SecretProviderLike;
  const record = await getDisconnectRecord(knex, tenantId, provider);
  if (!record) {
    return { status: 'no_credentials', record: null, error: 'No disconnect record exists for this provider.' };
  }
  if (record.status === 'finalized') {
    return { status: 'already_disconnected', record };
  }

  const hasPending = record.targets.some((target) => target.status === 'pending_revocation');
  if (hasPending) {
    return {
      status: 'pending',
      record,
      error: 'Some targets are still retrying. Let the retry finish, or resolve the transient failures first.',
    };
  }

  // Atomic-in-effect like the automatic finalization path: `finalized` only
  // after the tombstoned credential secret is actually deleted. A deletion
  // failure propagates so the operator sees it and the record stays in its
  // current state (never finalized over orphaned credential material).
  await clearTombstoneCredentialsStrict(tenantId, provider, secretProvider);

  // The terminal transition and its audit event commit together: force-finalize
  // is a deliberate, audited operator action, so a finalization the audit trail
  // cannot attest to must not be reported as success. The audit row is written
  // first (it is the transition's precondition); a failure of either write
  // rolls the transaction back, the record keeps its operator-actionable
  // status, and a retried force-finalize converges — the strict tombstone
  // deletion above treats an already-absent secret as success.
  try {
    await knex.transaction(async (trx) => {
      await writeDisconnectAuditInTransaction(trx, {
        tenantId,
        provider,
        operation: 'disconnect_force_finalized',
        targetId: null,
        result: 'force_finalized',
        attemptCount: record.attemptCount + 1,
        correlationId: record.correlationId,
        userId: opts.userId,
        reason: opts.reason,
      });
      await setRecordStatus(trx, tenantId, provider, 'finalized', {
        attemptCount: record.attemptCount + 1,
        nextRetryAt: null,
        finalizedAt: new Date().toISOString(),
        finalizeReason: opts.reason,
      });
    });
  } catch (error) {
    logger.error(
      '[providerDisconnect] Force-finalize could not durably record its terminal transition; the record stays operator-actionable',
      {
        tenantId,
        provider,
        correlationId: record.correlationId,
        error: error instanceof Error ? error.message : error,
      },
    );
    throw error;
  }
  if (provider === PROVIDER_QBO) {
    await notifyQboConnectionChanged(tenantId);
  }

  const latest = await getDisconnectRecord(knex, tenantId, provider);
  logger.warn('[providerDisconnect] Operator force-finalized provider disconnect', {
    tenantId,
    provider,
    correlationId: record.correlationId,
    reason: opts.reason,
  });
  return { status: 'disconnected', record: latest ?? record };
}
