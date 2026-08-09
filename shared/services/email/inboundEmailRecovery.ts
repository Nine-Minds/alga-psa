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
  deadletterArtifact,
  deadletterIngress,
  deadletterInbox,
  deadletterInboundEventDelivery,
  deadletterOutboxRow,
  findDueArtifacts,
  findDueIngress,
  findDueInbox,
  findDueOutbox,
  findRecoverableInboundEventDeliveries,
  getDurableMaxAttempts,
  getInboxByIdentity,
  insertEffect,
  getInboundDurableMode,
  upsertInbox,
  type InboundEventDeliveryRecord,
  type InboundIngressRecord,
} from './inboundEmailDurableStore';
import { enqueueInboundEmailDurableJob } from './unifiedInboundEmailQueueV2';
import { normalizeInboundMessageIdentity, parseCanonicalInboundIdentity } from './inboundEmailIdentity';
import { buildInboundSourceObjectKey } from './inboundEmailIdentity';
import type { InboundProviderPointer } from './inboundEmailProducer';

const MIRROR_MARKER = 'durableMirrored';

export interface RecoverySweepResult {
  enqueued: {
    ingress: number;
    inbox: number;
    artifact: number;
    outbox: number;
    deliveries: number;
  };
}

export async function sweepTenantDurableWork(tenant: string, limit: number = 10): Promise<RecoverySweepResult> {
  const db = await (await import('@alga-psa/db/admin')).getAdminConnection();
  const result: RecoverySweepResult = { enqueued: { ingress: 0, inbox: 0, artifact: 0, outbox: 0, deliveries: 0 } };
  const maxAttempts = getDurableMaxAttempts();

  const ingressRows = await findDueIngress(db, { tenant, limit });
  for (const row of ingressRows) {
    // Exhausted retryable rows dead-letter into a queryable terminal state
    // instead of being re-woken forever.
    if (row.status === 'retryable_failed' && row.attempt_count >= maxAttempts) {
      await deadletterIngress(db, row);
      continue;
    }
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

  // In shadow mode the durable processor does not run; legacy is authoritative
  // and shadow-staged inbox rows stay non-terminal for enforce-mode reconciliation.
  if (getInboundDurableMode() !== 'shadow') {
    const inboxRows = await findDueInbox(db, { tenant, limit });
    for (const row of inboxRows) {
      if (row.status === 'retryable_failed' && row.attempt_count >= maxAttempts) {
        await deadletterInbox(db, row);
        continue;
      }
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
  }

  const artifactRows = await findDueArtifacts(db, { tenant, limit });
  for (const row of artifactRows) {
    if (row.status === 'retryable_failed' && row.attempt_count >= maxAttempts) {
      await deadletterArtifact(db, row);
      continue;
    }
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
    if (row.status === 'retryable_failed' && row.attempt_count >= maxAttempts) {
      await deadletterOutboxRow(db, row);
      continue;
    }
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

  // Consumer delivery recovery. The outbox row itself is already `published`
  // after Redis accept, so a consumer-side loss after publish is NOT re-driven
  // by the outbox claim path. Recoverable consumer deliveries (expired
  // `delivering` reservations, or due under-cap `retryable_failed` rows) are
  // re-driven here by re-publishing the outbox event once per distinct outbox
  // row; each consumer's per-consumer gate reclaims its own reservation.
  const deliveryRows = await findRecoverableInboundEventDeliveries(db, { tenant, limit });
  const republishOutboxIds = new Set<string>();
  for (const delivery of deliveryRows) {
    if (delivery.status === 'retryable_failed' && delivery.attempt_count >= maxAttempts) {
      await deadletterInboundEventDelivery(db, delivery as InboundEventDeliveryRecord);
      continue;
    }
    republishOutboxIds.add(delivery.outbox_id);
  }
  for (const outboxId of republishOutboxIds) {
    try {
      await enqueueInboundEmailDurableJob({
        workType: 'republish_outbox_event',
        tenantId: tenant,
        recordId: outboxId,
      });
      result.enqueued.deliveries += 1;
    } catch (error: any) {
      console.warn('[InboundEmailRecovery] consumer delivery re-drive enqueue failed', {
        event: 'inbound_email_recovery_delivery_republish_enqueue_failed',
        tenantId: tenant,
        outboxId,
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
 * Parse the legacy `message_id` value, which the old pipeline stored as
 * `provider:<opaque-id>`, back into a provider type plus the underlying id so
 * the durable identity is derived from the same provider form instead of a
 * fabricated rfc822 value. Returns null for malformed values.
 */
function parseLegacyMessageIdentity(messageId: string): { providerType: InboundProviderType; rest: string } | null {
  if (messageId.startsWith('google:')) return { providerType: 'google', rest: messageId.slice('google:'.length) };
  if (messageId.startsWith('microsoft:')) return { providerType: 'microsoft', rest: messageId.slice('microsoft:'.length) };
  if (messageId.startsWith('imap:')) return { providerType: 'imap', rest: messageId.slice('imap:'.length) };
  return null;
}

/**
 * The raw entity-lookup key the legacy pipeline wrote into
 * `tickets.email_metadata.messageId` and `comments.metadata.email.messageId`
 * (it was `emailData.id`). Prefer the headers snapshot; fall back to the
 * provider portion of the audit message_id. A durable-mirrored audit row stores
 * the CANONICAL normalized identity (`rfc822:…`/`provider:…`/`imap:…`) in
 * `message_id`, but the durable pipeline wrote the unprefixed form into the
 * entity metadata — so a canonical value is unwrapped to its raw entity key.
 */
function resolveLegacyEntityKey(legacy: LegacyProcessedRow): string | null {
  const snapshot = legacy.metadata?.headersSnapshot as Record<string, unknown> | undefined;
  const snapKey = typeof snapshot?.messageId === 'string' ? snapshot.messageId.trim() : '';
  if (snapKey) return snapKey;
  const parsed = parseLegacyMessageIdentity(legacy.message_id);
  if (parsed?.rest?.trim()) return parsed.rest.trim();
  const canonical = parseCanonicalInboundIdentity(legacy.message_id);
  if (canonical) {
    const unwrapped = canonical.rfcMessageId ?? canonical.providerMessageId ?? null;
    if (unwrapped) return unwrapped;
  }
  return legacy.message_id.trim() || null;
}

type LegacyReconciliation =
  | { matched: true; ticketId: string; commentId: string }
  | { matched: false; reason: 'none' | 'ambiguous_ticket' | 'ambiguous_comment' | 'missing_ticket' | 'missing_comment' };

/**
 * Reconcile an unambiguous existing ticket + comment for a legacy message
 * WITHOUT creating anything. Exactly one of each is linked; multiple
 * conflicting matches are surfaced for review and never trigger a third entity.
 */
async function reconcileLegacyEntities(
  db: any,
  tenant: string,
  providerId: string,
  messageKey: string,
  ticketHint?: string | null
): Promise<LegacyReconciliation> {
  const { tenantDb } = await import('@alga-psa/db');

  let ticketId: string | null = null;
  if (ticketHint) {
    ticketId = ticketHint;
  } else {
    const tickets = await tenantDb(db, tenant).table('tickets')
      .whereRaw("email_metadata->>'messageId' = ?", [messageKey])
      .andWhere(function (this: any) {
        this.whereRaw("email_metadata->>'providerId' = ?", [providerId]).orWhereRaw(
          "email_metadata->>'provider_id' = ?",
          [providerId]
        );
      })
      .select('ticket_id');
    if (tickets.length > 1) return { matched: false, reason: 'ambiguous_ticket' };
    ticketId = tickets[0] ? String(tickets[0].ticket_id) : null;
  }

  const comments = await tenantDb(db, tenant).table('comments')
    .whereRaw("metadata->'email'->>'messageId' = ?", [messageKey])
    .select('comment_id', 'ticket_id');
  const onTicket = ticketId ? comments.filter((c: any) => String(c.ticket_id) === ticketId) : comments;
  if (onTicket.length > 1) return { matched: false, reason: 'ambiguous_comment' };

  if (ticketId && onTicket[0]) {
    return { matched: true, ticketId, commentId: String(onTicket[0].comment_id) };
  }
  if (ticketId && !onTicket[0]) return { matched: false, reason: 'missing_comment' };
  if (!ticketId && comments.length > 0) return { matched: false, reason: 'missing_ticket' };
  return { matched: false, reason: 'none' };
}

/**
 * Derive a provider pointer from legacy audit metadata so a stale `processing`
 * row with no entities can be re-fetched and staged (become retryable). Only a
 * real pointer recorded in the audit metadata counts — the audit `message_id`
 * itself is not a usable pointer (the message may no longer exist).
 */
function deriveLegacyPointer(
  legacy: LegacyProcessedRow
): InboundProviderPointer | null {
  const pointer = (legacy.metadata?.pointer ?? {}) as Record<string, unknown>;
  const queueProvider = legacy.metadata?.queueProvider;
  if (queueProvider === 'microsoft') {
    const messageId = typeof pointer.messageId === 'string' ? pointer.messageId : null;
    if (messageId) return { providerType: 'microsoft', providerMessageId: messageId };
  }
  if (queueProvider === 'google') {
    const historyId = typeof pointer.historyId === 'string' ? pointer.historyId : null;
    if (historyId) {
      return {
        providerType: 'google',
        historyId,
        pubsubMessageId: typeof pointer.pubsubMessageId === 'string' ? pointer.pubsubMessageId : null,
      };
    }
  }
  if (queueProvider === 'imap') {
    const mailbox = typeof pointer.mailbox === 'string' ? pointer.mailbox : null;
    const uid = pointer.uid;
    const uidValidity = typeof pointer.uidValidity === 'string' ? pointer.uidValidity : null;
    if (mailbox && (typeof uid === 'string' || typeof uid === 'number')) {
      return { providerType: 'imap', mailbox, uid: String(uid), uidValidity };
    }
  }
  return null;
}

function resolveLegacyProviderType(legacy: LegacyProcessedRow): InboundProviderType {
  const queueProvider = legacy.metadata?.queueProvider;
  if (queueProvider === 'microsoft' || queueProvider === 'google' || queueProvider === 'imap') {
    return queueProvider;
  }
  const parsed = parseLegacyMessageIdentity(legacy.message_id);
  return parsed?.providerType ?? 'imap';
}

/**
 * Insert a legacy-imported inbox row directly in its terminal state. Legacy
 * imports carry no real staged source, so the `source_required_check` only
 * permits them terminal (`legacy_imported = true` + terminal status); inserting
 * as `received` first would violate the check.
 */
async function upsertLegacyInbox(
  db: any,
  params: {
    tenant: string;
    legacy: LegacyProcessedRow;
    identity: { normalized: string; rfcMessageId: string | null };
    providerType: InboundProviderType;
    providerMessageId?: string | null;
    status: 'succeeded' | 'skipped' | 'terminal_failed';
    outcome_kind?: 'reconciled' | 'skipped' | null;
    outcome_reason?: string | null;
    ticket_id?: string | null;
    comment_id?: string | null;
    lastError?: string | null;
  }
): Promise<InboundEmailInboxRecord> {
  return upsertInbox(db, {
    tenant: params.tenant,
    ingress_id: null,
    provider_id: params.legacy.provider_id,
    provider_type: params.providerType,
    normalized_message_id: params.identity.normalized,
    provider_message_id: params.providerMessageId ?? params.legacy.message_id,
    rfc_message_id: params.identity.rfcMessageId,
    source_object_key: buildInboundSourceObjectKey({
      tenant: params.tenant,
      providerId: params.legacy.provider_id,
      normalizedMessageId: params.identity.normalized,
      sourceSha256: 'legacy',
    }),
    source_sha256: 'legacy',
    source_size_bytes: 0,
    source_staged_at: new Date(),
    envelope: {
      legacyMessageId: params.legacy.message_id,
      from: params.legacy.from_email,
      subject: params.legacy.subject,
      receivedAt: params.legacy.received_at,
    },
    legacy_imported: true,
    status: params.status,
    outcome_kind: params.outcome_kind ?? null,
    outcome_reason: params.outcome_reason ?? null,
    ticket_id: params.ticket_id ?? null,
    comment_id: params.comment_id ?? null,
    last_error: params.lastError ?? null,
  });
}

/**
 * Import a bounded batch of legacy `email_processed_messages` rows into the
 * durable ledgers. Resumable: rows whose normalized identity already has a
 * `legacy_imported` inbox row are skipped (the inbox row is the checkpoint),
 * and every row's writes are committed atomically inside one transaction so a
 * crash mid-row rolls back and a re-run from the start converges to the
 * identical end state. Never guesses missing effects; ambiguity is
 * terminal/alerted.
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

    const providerType = resolveLegacyProviderType(legacy);
    const parsedIdentity = parseLegacyMessageIdentity(legacy.message_id);
    // A durable-mirrored audit row stores the CANONICAL normalized identity in
    // `message_id` (`rfc822:…`/`provider:…`/`imap:…`). Feed that through as-is
    // so the idempotent normalizer preserves the original scheme instead of
    // re-deriving a drifted (double-prefixed) key that misses the succeeded
    // inbox row. Genuine legacy rows keep the provider-rest extraction.
    const alreadyCanonical = parseCanonicalInboundIdentity(legacy.message_id);
    const identity = normalizeInboundMessageIdentity({
      providerType,
      rfcMessageId: alreadyCanonical
        ? legacy.message_id
        : providerType === 'imap'
          ? parsedIdentity?.rest ?? legacy.message_id
          : null,
      providerMessageId: alreadyCanonical
        ? null
        : providerType !== 'imap'
          ? parsedIdentity?.rest ?? legacy.message_id
          : null,
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

    const status = String(legacy.processing_status || 'success').toLowerCase();
    const messageKey = resolveLegacyEntityKey(legacy);
    const legacyInboxBase = {
      tenant,
      legacy,
      identity,
      providerType,
      providerMessageId: parsedIdentity?.rest ?? null,
      lastError: legacy.error_message ?? null,
    };

    // A failed/partial row is never replayable without a real source/pointer;
    // import it as a terminal failure for review. Runs inside a transaction so
    // a crash leaves no partial ledger state.
    const terminalImport = async (
      outcomeReason: string,
      opts: { status?: 'succeeded' | 'skipped' | 'terminal_failed'; outcome_kind?: 'reconciled' | 'skipped' | null; ticketId?: string | null; commentId?: string | null } = {}
    ): Promise<void> => {
      await db.transaction(async (trx) => {
        await upsertLegacyInbox(trx, {
          ...legacyInboxBase,
          status: opts.status ?? 'terminal_failed',
          outcome_kind: opts.outcome_kind ?? null,
          outcome_reason: outcomeReason,
          ticket_id: opts.ticketId ?? null,
          comment_id: opts.commentId ?? null,
        });
      });
    };

    if (status === 'success') {
      // Map legacy success to `succeeded` only when its ticket AND comment can
      // both be reconciled unambiguously; otherwise import it as terminal_failed
      // with the legacy result preserved for review — never guess an effect.
      if (!messageKey) {
        await terminalImport('legacy_success_no_entity_key');
        result.imported += 1;
        continue;
      }
      const imported = await importReconciledLegacySuccess(db, tenant, legacy, legacyInboxBase, identity, messageKey);
      if (imported.reconciled) {
        result.imported += 1;
        continue;
      }
      await terminalImport(`legacy_success_reconcile_${imported.reason}`);
      result.ambiguous += 1;
      continue;
    }

    if (status === 'skipped') {
      await db.transaction(async (trx) => {
        await upsertLegacyInbox(trx, {
          ...legacyInboxBase,
          status: 'skipped',
          outcome_kind: 'skipped',
          outcome_reason: String(legacy.error_message || 'legacy_skipped'),
        });
      });
      result.imported += 1;
      continue;
    }

    // Stale `processing` (the incident shape): reconcile any already-created
    // entities and complete the state without creating another. With no
    // entities, become retryable via durable ingress work when a pointer is
    // available, otherwise terminal_failed rather than creating from
    // incomplete data.
    if (status === 'processing') {
      if (messageKey) {
        const imported = await importReconciledLegacySuccess(db, tenant, legacy, legacyInboxBase, identity, messageKey);
        if (imported.reconciled) {
          result.imported += 1;
          continue;
        }
        if (imported.reason === 'ambiguous_ticket' || imported.reason === 'ambiguous_comment') {
          await terminalImport(`legacy_processing_reconcile_${imported.reason}`);
          result.ambiguous += 1;
          continue;
        }
      }

      const pointer = deriveLegacyPointer(legacy);
      if (pointer) {
        // No entities to link but a usable provider pointer exists: create
        // durable ingress work so the source can be staged and re-processed.
        // The legacy row stays untouched; the inbox row is the checkpoint once
        // staging creates it. persistIngressPointer is idempotent, so a crash
        // after this point is safe to repeat.
        try {
          const { persistIngressPointer } = await import('./inboundEmailProducer');
          const produced = await persistIngressPointer({
            tenant,
            providerId: legacy.provider_id,
            providerType: pointer.providerType,
            pointer,
          });
          if (produced.ingressId) {
            result.imported += 1;
            continue;
          }
        } catch (error: any) {
          console.warn('[InboundEmailRecovery] legacy pointer ingress persist failed', {
            event: 'inbound_email_recovery_legacy_pointer_ingress_failed',
            tenantId: tenant,
            providerId: legacy.provider_id,
            messageId: legacy.message_id,
            error: error?.message || String(error),
          });
        }
        await terminalImport('legacy_processing_pointer_ingress_failed');
        result.imported += 1;
        continue;
      }

      await terminalImport('legacy_processing_unrecoverable');
      result.imported += 1;
      continue;
    }

    // failed / partial: import as terminal failure for review unless a
    // source/pointer and retry policy allow retry (never guessed here).
    await terminalImport(`legacy_${status}_not_replayable`);
    result.imported += 1;
  }

  return result;
}

/**
 * Reconcile and import a legacy row that is expected to have an existing
 * ticket + comment (legacy `success` or stale `processing`). All writes —
 * inbox row plus both effect rows — happen in ONE transaction so a crash
 * mid-row leaves no partial ledger and a re-run converges.
 */
async function importReconciledLegacySuccess(
  db: any,
  tenant: string,
  legacy: LegacyProcessedRow,
  legacyInboxBase: Omit<Parameters<typeof upsertLegacyInbox>[1], 'status' | 'outcome_kind' | 'outcome_reason' | 'ticket_id' | 'comment_id'>,
  identity: NonNullable<ReturnType<typeof normalizeInboundMessageIdentity>>,
  messageKey: string
): Promise<{ reconciled: boolean; ambiguous: boolean; reason: string }> {
  try {
    const imported = await db.transaction(async (trx: any) => {
      const reconciliation = await reconcileLegacyEntities(trx, tenant, legacy.provider_id, messageKey, legacy.ticket_id);
      if (reconciliation.matched !== true) {
        return { reconciled: false as const, ambiguous: true as const, reason: reconciliation.reason };
      }
      const inbox = await upsertLegacyInbox(trx, {
        ...legacyInboxBase,
        status: 'succeeded',
        outcome_kind: 'reconciled',
        ticket_id: reconciliation.ticketId,
        comment_id: reconciliation.commentId,
      });
      await insertEffect(trx, {
        tenant,
        provider_id: legacy.provider_id,
        normalized_message_id: identity.normalized,
        effect_type: 'ticket',
        inbox_id: inbox.inbox_id,
        entity_id: reconciliation.ticketId,
        ticket_id: reconciliation.ticketId,
        reconciled: true,
      });
      await insertEffect(trx, {
        tenant,
        provider_id: legacy.provider_id,
        normalized_message_id: identity.normalized,
        effect_type: 'comment',
        inbox_id: inbox.inbox_id,
        entity_id: reconciliation.commentId,
        ticket_id: reconciliation.ticketId,
        reconciled: true,
      });
      return { reconciled: true as const, ambiguous: false as const, reason: '' };
    });
    return imported;
  } catch (error: any) {
    // A uniqueness conflict on the inbox/effect insert means a concurrent
    // backfill already imported this row; the ledger is already in the target
    // state and the row is skipped on re-run. Do not treat it as ambiguity.
    if (isUniqueViolation(error)) {
      return { reconciled: true, ambiguous: false, reason: 'concurrent_import' };
    }
    throw error;
  }
}

function isUniqueViolation(error: any): boolean {
  const code = error?.code;
  const message = typeof error?.message === 'string' ? error.message : String(error?.message ?? '');
  return code === '23505' || message.includes('duplicate key value violates unique constraint');
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
