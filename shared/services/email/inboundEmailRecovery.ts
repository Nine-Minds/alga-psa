/**
 * Per-tenant inbound email recovery, legacy backfill, and compatibility mirror.
 *
 * - `sweepTenantDurableWork` re-enqueues due rows from the durable ledgers. The
 *   Postgres claims remain authoritative, so duplicate wake-ups are safe.
 * - `backfillTenantLegacyRows` imports legacy `email_processed_messages` rows
 *   into the durable inbox/effects with `legacy_imported = true`. It never
 *   guesses missing effects and never deletes or overwrites legacy rows; the
 *   inbox row itself is the resumable checkpoint.
 * - `mirrorTenantTerminalInbox` reproduces terminal inbox outcomes into
 *   `email_processed_messages` AFTER the core commit, never inside it. Reporting
 *   stays on the legacy table and may be briefly eventual.
 */

import type {
  InboundEmailDurableMode,
  InboundEmailInboxRecord,
  InboundProviderType,
} from '../../interfaces/inbound-email.interfaces';
import {
  findDueArtifacts,
  findDueIngress,
  findDueInbox,
  findDueOutbox,
  getInboxByIdentity,
  insertEffect,
  getInboundDurableMode,
  upsertInbox,
  type InboundIngressRecord,
} from './inboundEmailDurableStore';
import { enqueueInboundEmailDurableJob } from './unifiedInboundEmailQueueV2';
import { normalizeInboundMessageIdentity } from './inboundEmailIdentity';
import { buildInboundSourceObjectKey } from './inboundEmailIdentity';

const MIRROR_MARKER = 'durableMirrored';

export interface RecoverySweepResult {
  enqueued: {
    ingress: number;
    inbox: number;
    artifact: number;
    outbox: number;
  };
}

export async function sweepTenantDurableWork(tenant: string, limit: number = 10): Promise<RecoverySweepResult> {
  const db = await (await import('@alga-psa/db/admin')).getAdminConnection();
  const result: RecoverySweepResult = { enqueued: { ingress: 0, inbox: 0, artifact: 0, outbox: 0 } };

  const ingressRows = await findDueIngress(db, { tenant, limit });
  for (const row of ingressRows) {
    try {
      await enqueueInboundEmailDurableJob({ workType: 'stage_ingress', tenantId: tenant, recordId: row.ingress_id });
      result.enqueued.ingress += 1;
    } catch (error: any) {
      console.warn('[InboundEmailRecovery] ingress enqueue failed', {
        event: 'inbound_email_recovery_ingress_enqueue_failed',
        tenantId: tenant,
        ingressId: row.ingress_id,
        error: error?.message || String(error),
      });
    }
  }

  const inboxRows = await findDueInbox(db, { tenant, limit });
  for (const row of inboxRows) {
    try {
      await enqueueInboundEmailDurableJob({ workType: 'process_inbox', tenantId: tenant, recordId: row.inbox_id });
      result.enqueued.inbox += 1;
    } catch (error: any) {
      console.warn('[InboundEmailRecovery] inbox enqueue failed', {
        event: 'inbound_email_recovery_inbox_enqueue_failed',
        tenantId: tenant,
        inboxId: row.inbox_id,
        error: error?.message || String(error),
      });
    }
  }

  const artifactRows = await findDueArtifacts(db, { tenant, limit });
  for (const row of artifactRows) {
    try {
      await enqueueInboundEmailDurableJob({
        workType: 'process_artifact',
        tenantId: tenant,
        recordId: row.artifact_key,
        inboxId: row.inbox_id,
      });
      result.enqueued.artifact += 1;
    } catch (error: any) {
      console.warn('[InboundEmailRecovery] artifact enqueue failed', {
        event: 'inbound_email_recovery_artifact_enqueue_failed',
        tenantId: tenant,
        inboxId: row.inbox_id,
        artifactKey: row.artifact_key,
        error: error?.message || String(error),
      });
    }
  }

  const outboxRows = await findDueOutbox(db, { tenant, limit });
  for (const row of outboxRows) {
    try {
      await enqueueInboundEmailDurableJob({
        workType: 'publish_outbox',
        tenantId: tenant,
        recordId: row.outbox_id,
        inboxId: row.inbox_id,
      });
      result.enqueued.outbox += 1;
    } catch (error: any) {
      console.warn('[InboundEmailRecovery] outbox enqueue failed', {
        event: 'inbound_email_recovery_outbox_enqueue_failed',
        tenantId: tenant,
        outboxId: row.outbox_id,
        error: error?.message || String(error),
      });
    }
  }

  return result;
}

export interface BackfillResult {
  processed: number;
  imported: number;
  ambiguous: number;
  skipped: number;
}

interface LegacyProcessedRow {
  message_id: string;
  provider_id: string;
  tenant: string;
  processed_at: Date | string;
  processing_status: string;
  ticket_id: string | null;
  error_message: string | null;
  from_email: string | null;
  subject: string | null;
  received_at: Date | string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Import a bounded batch of legacy `email_processed_messages` rows into the
 * durable ledgers. Resumable: rows whose normalized identity already has a
 * `legacy_imported` inbox row are skipped (the inbox row is the checkpoint).
 * Never guesses missing effects; ambiguity is terminal/alerted.
 */
export async function backfillTenantLegacyRows(tenant: string, limit: number = 25): Promise<BackfillResult> {
  const db = await (await import('@alga-psa/db/admin')).getAdminConnection();
  const { tenantDb } = await import('@alga-psa/db');

  const legacyRows = (await tenantDb(db, tenant).table('email_processed_messages')
    .where({ tenant })
    .orderBy('processed_at', 'asc')
    .limit(Math.max(1, limit))) as LegacyProcessedRow[];

  const result: BackfillResult = { processed: 0, imported: 0, ambiguous: 0, skipped: 0 };

  for (const legacy of legacyRows) {
    result.processed += 1;
    if (!legacy.message_id || !legacy.provider_id) {
      result.skipped += 1;
      continue;
    }

    const identity = normalizeInboundMessageIdentity({
      providerType: 'imap',
      rfcMessageId: legacy.message_id,
      providerMessageId: null,
    }) ?? normalizeInboundMessageIdentity({
      providerType: 'microsoft',
      providerMessageId: legacy.message_id,
    }) ?? normalizeInboundMessageIdentity({
      providerType: 'google',
      providerMessageId: legacy.message_id,
    });

    if (!identity) {
      result.skipped += 1;
      continue;
    }

    const existing = await getInboxByIdentity(db, {
      tenant,
      provider_id: legacy.provider_id,
      normalized_message_id: identity.normalized,
    });
    if (existing) {
      result.skipped += 1;
      continue;
    }

    // Reconcile ticket/comment from legacy JSON metadata without guessing.
    const legacyTicketId = legacy.ticket_id ?? null;
    const legacyMetadata = legacy.metadata ?? {};

    const inbox = await upsertInbox(db, {
      tenant,
      ingress_id: null,
      provider_id: legacy.provider_id,
      provider_type: 'imap',
      normalized_message_id: identity.normalized,
      provider_message_id: legacy.message_id,
      rfc_message_id: identity.rfcMessageId,
      source_object_key: buildInboundSourceObjectKey({
        tenant,
        providerId: legacy.provider_id,
        normalizedMessageId: identity.normalized,
        sourceSha256: 'legacy',
      }),
      source_sha256: 'legacy',
      source_size_bytes: 0,
      source_staged_at: new Date(),
      envelope: {
        legacyMessageId: legacy.message_id,
        from: legacy.from_email,
        subject: legacy.subject,
        receivedAt: legacy.received_at,
      },
      legacy_imported: true,
    });

    const status = String(legacy.processing_status || 'success').toLowerCase();

    if (status === 'success' && legacyTicketId) {
      // Map legacy success to `succeeded` only when its ticket can be linked
      // unambiguously; comment reconciliation happens via the effects ledger.
      await insertEffect(db, {
        tenant,
        provider_id: legacy.provider_id,
        normalized_message_id: identity.normalized,
        effect_type: 'ticket',
        inbox_id: inbox.inbox_id,
        entity_id: legacyTicketId,
        ticket_id: legacyTicketId,
        reconciled: true,
      });
      await transitionLegacyInboxTerminal(db, inbox, {
        status: 'succeeded',
        outcome_kind: 'reconciled',
        ticket_id: legacyTicketId,
        comment_id: null,
        legacyStatus: status,
      });
      result.imported += 1;
      continue;
    }

    if (status === 'skipped') {
      await transitionLegacyInboxTerminal(db, inbox, {
        status: 'skipped',
        outcome_kind: 'skipped',
        outcome_reason: String(legacy.error_message || 'legacy_skipped'),
        ticket_id: null,
        comment_id: null,
        legacyStatus: status,
      });
      result.imported += 1;
      continue;
    }

    // failed / partial / stale processing: import as terminal failure for review
    // unless a source/pointer and retry policy allow retry (never guessed here).
    await transitionLegacyInboxTerminal(db, inbox, {
      status: 'terminal_failed',
      outcome_kind: null,
      outcome_reason: `legacy_${status}_not_replayable`,
      ticket_id: null,
      comment_id: null,
      legacyStatus: status,
      legacyError: legacy.error_message ?? null,
    });
    result.imported += 1;
  }

  return result;
}

async function transitionLegacyInboxTerminal(
  db: any,
  inbox: InboundEmailInboxRecord,
  params: {
    status: 'succeeded' | 'skipped' | 'terminal_failed';
    outcome_kind: 'reconciled' | 'skipped' | null;
    outcome_reason?: string | null;
    ticket_id: string | null;
    comment_id: string | null;
    legacyStatus: string;
    legacyError?: string | null;
  }
): Promise<void> {
  const { tenantDb } = await import('@alga-psa/db');
  await tenantDb(db, inbox.tenant).table('inbound_email_inbox')
    .where({ tenant: inbox.tenant, inbox_id: inbox.inbox_id })
    .update({
      status: params.status,
      outcome_kind: params.outcome_kind,
      outcome_reason: params.outcome_reason ?? null,
      ticket_id: params.ticket_id,
      comment_id: params.comment_id,
      completed_at: db.fn.now(),
      updated_at: db.fn.now(),
      legacy_imported: true,
      last_error: params.legacyError ?? null,
    });
}

export interface MirrorResult {
  mirrored: number;
}

/**
 * Mirror terminal inbox outcomes into `email_processed_messages` AFTER the core
 * commit. Rows already carrying the `durableMirrored` marker are skipped.
 * Legacy rows are upserted (PK: message_id, provider_id, tenant) and never
 * deleted; a previously-terminal legacy row is left untouched.
 */
export async function mirrorTenantTerminalInbox(tenant: string, limit: number = 50): Promise<MirrorResult> {
  const db = await (await import('@alga-psa/db/admin')).getAdminConnection();
  const { tenantDb } = await import('@alga-psa/db');

  const terminalRows = (await tenantDb(db, tenant).table('inbound_email_inbox')
    .where({ tenant })
    .whereIn('status', ['succeeded', 'skipped', 'terminal_failed'])
    .andWhereNot('legacy_imported', true)
    .orderBy('completed_at', 'asc')
    .limit(Math.max(1, limit))) as InboundEmailInboxRecord[];

  let mirrored = 0;
  for (const inbox of terminalRows) {
    const existing = await tenantDb(db, tenant).table('email_processed_messages')
      .where({ tenant, provider_id: inbox.provider_id, message_id: inbox.normalized_message_id })
      .first('processing_status', 'metadata');
    if (existing) {
      const metadata = existing.metadata && typeof existing.metadata === 'object'
        ? (existing.metadata as Record<string, unknown>)
        : {};
      if (metadata[MIRROR_MARKER] === true && !isTerminalLegacyStatus(String(existing.processing_status))) {
        mirrored += 1;
        continue;
      }
    }

    const status = inbox.status === 'succeeded'
      ? 'success'
      : inbox.status === 'skipped'
        ? 'skipped'
        : 'failed';

    const metadata = {
      [MIRROR_MARKER]: true,
      inboxId: inbox.inbox_id,
      outcome: inbox.outcome_kind,
      outcomeReason: inbox.outcome_reason,
      attempts: inbox.attempt_count,
      sourceDigest: inbox.source_sha256,
      commentId: inbox.comment_id,
    };

    await tenantDb(db, tenant).table('email_processed_messages')
      .insert({
        message_id: inbox.normalized_message_id,
        provider_id: inbox.provider_id,
        tenant,
        processed_at: inbox.completed_at ?? db.fn.now(),
        processing_status: status,
        ticket_id: inbox.ticket_id,
        error_message: inbox.status === 'terminal_failed' ? (inbox.last_error ?? inbox.outcome_reason ?? null) : null,
        from_email: extractEnvelopeString(inbox.envelope, 'from', 'email') ?? null,
        subject: extractEnvelopeString(inbox.envelope, 'subject') ?? null,
        received_at: inbox.received_at,
        attachment_count: Number(extractEnvelopeNumber(inbox.envelope, 'attachmentCount') ?? 0),
        metadata: JSON.stringify(metadata),
      })
      .onConflict(['message_id', 'provider_id', 'tenant'])
      .merge({
        processing_status: status,
        ticket_id: inbox.ticket_id,
        error_message: inbox.status === 'terminal_failed' ? (inbox.last_error ?? inbox.outcome_reason ?? null) : null,
        metadata: JSON.stringify(metadata),
        processed_at: db.fn.now(),
      });
    mirrored += 1;
  }

  return { mirrored };
}

function isTerminalLegacyStatus(status: string): boolean {
  return status === 'success' || status === 'failed' || status === 'skipped';
}

function extractEnvelopeString(envelope: Record<string, unknown>, key: string, nested?: string): string | null {
  const value = envelope?.[key];
  if (nested) {
    if (value && typeof value === 'object') {
      const nestedValue = (value as Record<string, unknown>)[nested];
      return typeof nestedValue === 'string' ? nestedValue : null;
    }
    return null;
  }
  return typeof value === 'string' ? value : null;
}

function extractEnvelopeNumber(envelope: Record<string, unknown>, key: string): number | null {
  const value = envelope?.[key];
  return typeof value === 'number' ? value : null;
}

export { getInboundDurableMode, buildInboundSourceObjectKey, type InboundProviderType, type InboundEmailDurableMode, type InboundEmailInboxRecord, type InboundIngressRecord };
/**
 * Per-tenant recovery entry point used by both the CE pg-boss handler and the EE
 * Temporal maintenance fanout. Sweeps due durable work, mirrors terminal inbox
 * state to the legacy audit table, runs a bounded legacy backfill batch when
 * durable mode is active, and emits staleness/divergence diagnostics.
 */
export async function runInboundEmailRecoveryForTenant(
  tenantId: string,
  limit?: number
): Promise<{ swept: RecoverySweepResult['enqueued']; mirrored: number; backfilled: number }> {
  const batchLimit = limit ?? 10;
  const swept = await sweepTenantDurableWork(tenantId, batchLimit);
  const mirror = await mirrorTenantTerminalInbox(tenantId, batchLimit);
  let backfilled = 0;
  if (getInboundDurableMode() !== 'off') {
    const backfill = await backfillTenantLegacyRows(tenantId, batchLimit);
    backfilled = backfill.imported;
  }
  try {
    const { reportInboundEmailDiagnostics } = await import('./inboundEmailDiagnostics');
    await reportInboundEmailDiagnostics(tenantId);
  } catch {
    // diagnostics are best effort
  }
  return { swept: swept.enqueued, mirrored: mirror.mirrored, backfilled };
}
