import type { Knex } from 'knex';
import { getDisconnectRecord } from './repository';
import type { ProviderDisconnectStatusInfo, ProviderType } from './types';

/**
 * User-visible disconnect summary for the connection-status surface. Returns
 * null when no disconnect record exists (the normal connected state).
 */
export async function getProviderDisconnectStatusInfo(
  knex: Knex,
  tenantId: string,
  provider: ProviderType,
): Promise<ProviderDisconnectStatusInfo | null> {
  const record = await getDisconnectRecord(knex, tenantId, provider);
  if (!record) {
    return null;
  }
  return {
    status: record.status,
    targets: record.targets.map((target) => ({
      targetId: target.targetId,
      status: target.status,
      errorClass: target.errorClass ?? null,
    })),
    attemptCount: record.attemptCount,
    correlationId: record.correlationId,
    nextRetryAt: record.nextRetryAt,
    finalizedAt: record.finalizedAt,
    finalizeReason: record.finalizeReason,
  };
}

/**
 * True while a non-finalized disconnect record exists for the provider —
 * the persisted tombstone that blocks sync/export while provider cleanup is in
 * flight. Used by explicit early checks for good errors.
 */
export async function isProviderDisconnectActive(
  knex: Knex,
  tenantId: string,
  provider: ProviderType,
): Promise<boolean> {
  const record = await getDisconnectRecord(knex, tenantId, provider);
  return record !== null && record.status !== 'finalized';
}
