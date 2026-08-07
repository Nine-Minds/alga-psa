/**
 * Durable inbound email producers.
 *
 * Producers persist an `inbound_email_ingress` row BEFORE relying on Redis.
 * Under durable mode (`shadow` or `enforce`) they hand off a V2 `stage_ingress`
 * wake-up (or stage an already-fetched source directly, as IMAP does) and do
 * NOT advance any provider cursor past an unstaged message. Under `off` mode
 * they preserve the legacy V1 pointer handoff exactly.
 */

import { getInboundDurableMode } from './inboundEmailDurableStore';
import { enqueueInboundEmailDurableJob } from './unifiedInboundEmailQueueV2';
import { upsertIngress } from './inboundEmailDurableStore';
import { buildIngressKey } from './inboundEmailIdentity';
import { stageIngressFromReadySource } from './inboundEmailIngressStagingWorker';

export interface InboundProviderPointer {
  providerType: 'microsoft' | 'google' | 'imap';
  providerMessageId?: string | null;
  historyId?: string | null;
  pubsubMessageId?: string | null;
  mailbox?: string | null;
  uidValidity?: string | null;
  uid?: string | number | null;
  extra?: Record<string, unknown>;
}

export interface PersistIngressResult {
  /** True when any durable mode (shadow or enforce) is active. */
  durable: boolean;
  /** Effective durable mode: 'off' | 'shadow' | 'enforce'. */
  mode: 'off' | 'shadow' | 'enforce';
  ingressId: string | null;
  enqueued: boolean;
}

/**
 * Persist the durable ingress pointer and, when durable mode is active, enqueue
 * a V2 `stage_ingress` wake-up. Returns `{ durable: false }` in off mode so
 * callers keep the legacy V1 handoff.
 *
 * Shadow mode does NOT divert the handoff: callers must fall through to the
 * legacy `enqueueUnifiedInboundEmailQueueJob` so legacy effects stay
 * authoritative while the durable path only stages sources for coverage.
 * Only `enforce` mode diverts the handoff to the V2 durable pipeline.
 */
export async function persistIngressPointer(params: {
  tenant: string;
  providerId: string;
  providerType: InboundProviderPointer['providerType'];
  pointer: InboundProviderPointer;
}): Promise<PersistIngressResult> {
  const mode = getInboundDurableMode();
  if (mode === 'off') {
    return { durable: false, mode, ingressId: null, enqueued: false };
  }

  const db = await (await import('@alga-psa/db/admin')).getAdminConnection();
  const ingressKey = buildIngressKey({
    providerType: params.pointer.providerType,
    providerMessageId: params.pointer.providerMessageId,
    historyId: params.pointer.historyId,
    pubsubMessageId: params.pointer.pubsubMessageId,
    mailbox: params.pointer.mailbox,
    uidValidity: params.pointer.uidValidity,
    uid: params.pointer.uid,
  });
  if (!ingressKey) {
    console.warn('[InboundEmailProducer] cannot derive ingress key for pointer', {
      event: 'inbound_email_producer_ingress_key_missing',
      tenantId: params.tenant,
      providerId: params.providerId,
      providerType: params.pointer.providerType,
    });
    return { durable: true, mode, ingressId: null, enqueued: false };
  }

  const ingress = await upsertIngress(db, {
    tenant: params.tenant,
    provider_id: params.providerId,
    provider_type: params.pointer.providerType,
    ingress_key: ingressKey,
    provider_pointer: {
      ...(params.pointer.extra ?? {}),
      providerMessageId: params.pointer.providerMessageId ?? null,
      historyId: params.pointer.historyId ?? null,
      pubsubMessageId: params.pointer.pubsubMessageId ?? null,
      mailbox: params.pointer.mailbox ?? null,
      uidValidity: params.pointer.uidValidity ?? null,
      uid: params.pointer.uid ?? null,
    },
  });

  try {
    await enqueueInboundEmailDurableJob({
      workType: 'stage_ingress',
      tenantId: params.tenant,
      recordId: ingress.ingress_id,
    });
    return { durable: true, mode, ingressId: ingress.ingress_id, enqueued: true };
  } catch (error: any) {
    console.warn('[InboundEmailProducer] stage_ingress enqueue failed (sweeper will recover)', {
      event: 'inbound_email_producer_stage_enqueue_failed',
      tenantId: params.tenant,
      providerId: params.providerId,
      ingressId: ingress.ingress_id,
      error: error?.message || String(error),
    });
    return { durable: true, mode, ingressId: ingress.ingress_id, enqueued: false };
  }
}

export interface StageReadySourceResult {
  durable: boolean;
  inboxId: string | null;
}

/**
 * Stage an already-fetched raw MIME source (IMAP email-service path). Blocks
 * until the object upload and inbox insert succeed so the producer never
 * advances its cursor past an unstaged message. Returns null in off mode.
 *
 * In shadow mode the source is staged for coverage but a `process_inbox`
 * wake-up is NOT enqueued: legacy processing remains authoritative and the
 * inbox row stays non-terminal for later enforce-mode reconciliation.
 */
export async function stageReadyInboundSource(params: {
  tenant: string;
  providerId: string;
  providerType: InboundProviderPointer['providerType'];
  pointer: InboundProviderPointer;
  rawMime: Buffer;
}): Promise<StageReadySourceResult> {
  const mode = getInboundDurableMode();
  if (mode === 'off') {
    return { durable: false, inboxId: null };
  }

  const ingressKey = buildIngressKey({
    providerType: params.pointer.providerType,
    providerMessageId: params.pointer.providerMessageId,
    historyId: params.pointer.historyId,
    pubsubMessageId: params.pointer.pubsubMessageId,
    mailbox: params.pointer.mailbox,
    uidValidity: params.pointer.uidValidity,
    uid: params.pointer.uid,
  });
  if (!ingressKey) {
    return { durable: true, inboxId: null };
  }

  const inboxId = await stageIngressFromReadySource({
    tenant: params.tenant,
    providerId: params.providerId,
    providerType: params.pointer.providerType,
    ingressKey,
    pointer: {
      ...(params.pointer.extra ?? {}),
      providerMessageId: params.pointer.providerMessageId ?? null,
      historyId: params.pointer.historyId ?? null,
      pubsubMessageId: params.pointer.pubsubMessageId ?? null,
      mailbox: params.pointer.mailbox ?? null,
      uidValidity: params.pointer.uidValidity ?? null,
      uid: params.pointer.uid ?? null,
    },
    rawMime: params.rawMime,
  });

  if (inboxId && mode === 'enforce') {
    try {
      await enqueueInboundEmailDurableJob({
        workType: 'process_inbox',
        tenantId: params.tenant,
        recordId: inboxId,
      });
    } catch (error: any) {
      console.warn('[InboundEmailProducer] process_inbox enqueue failed after direct staging', {
        event: 'inbound_email_producer_process_enqueue_failed',
        tenantId: params.tenant,
        providerId: params.providerId,
        inboxId,
        error: error?.message || String(error),
      });
    }
  }
  return { durable: true, inboxId };
}
