import type { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { createTenantKnex } from '@alga-psa/db';
import { getDisconnectRecord, deleteDisconnectRecord } from './repository';
import { writeDisconnectAudit } from './audit';
import type { DisconnectRecordStatus, ProviderType } from './types';

/**
 * Retires a stale terminal provider-disconnect record when fresh credentials
 * are persisted for the same provider (a completed OAuth reconnect).
 *
 * The `provider_disconnect_records` row is keyed by (tenant, provider), so a
 * reconnect must retire the previous cycle's terminal row instead of leaving
 * it to short-circuit the next disconnect with `already_disconnected` — the
 * exact lifecycle defect this card fixes.
 *
 * Retires both terminal states deliberately:
 * - `finalized` — the normal terminal state after a confirmed disconnect (or
 *   an operator force-finalize). Reconnect must clear it so the next
 *   disconnect starts a fresh cycle.
 * - `failed_permanent` — the pre-force-finalize terminal state. A terminal row
 *   that coexists with freshly stored live credentials is stale by definition:
 *   the tenant has a brand-new authorization, and leaving the old row would
 *   make the next disconnect return `failed_permanent` and demand a pointless
 *   force-finalize on a connection the tenant clearly means to keep. It is
 *   retired defensively; the connect routes already block reconnect while the
 *   record is non-finalized, so this branch only fires if credentials were
 *   stored some other way.
 *
 * `pending_revocation` is never touched here: an in-flight disconnect stays in
 * control, and reconnect during one is blocked upstream. Any orphaned tombstone
 * credential material from a retired `failed_permanent` cycle is deliberately
 * left for the disconnect service, which clears it when it starts a fresh cycle
 * over live credentials.
 *
 * Best-effort: the retirement must never block credential storage, and a stale
 * row is independently neutralized by the disconnect service's guard (a
 * terminal record with live credentials starts a fresh cycle). A failure is
 * logged loudly.
 */
export async function retireTerminalDisconnectRecord(
  tenantId: string,
  provider: ProviderType,
  conn?: Knex,
): Promise<{ retired: boolean; recordStatus?: DisconnectRecordStatus }> {
  try {
    // The credential storage layer passes its lock-holding transaction so the
    // retirement serializes with disconnect initiation like the write it
    // precedes; standalone callers omit it and get their own connection.
    const knex = conn ?? (await createTenantKnex(tenantId)).knex;
    const record = await getDisconnectRecord(knex, tenantId, provider);
    if (!record) {
      return { retired: false };
    }
    if (record.status !== 'finalized' && record.status !== 'failed_permanent') {
      return { retired: false, recordStatus: record.status };
    }

    const correlationId = record.correlationId;
    await deleteDisconnectRecord(knex, tenantId, provider);
    await writeDisconnectAudit({
      knex,
      tenantId,
      provider,
      operation: 'disconnect_record_retired',
      targetId: null,
      result: 'retired_on_reconnect',
      correlationId,
    });
    logger.info('[providerDisconnect] Retired terminal disconnect record on credential storage', {
      tenantId,
      provider,
      status: record.status,
      correlationId,
    });
    return { retired: true, recordStatus: record.status };
  } catch (error) {
    logger.error('[providerDisconnect] Failed to retire terminal disconnect record on credential storage', {
      tenantId,
      provider,
      error: error instanceof Error ? error.message : error,
    });
    return { retired: false };
  }
}
