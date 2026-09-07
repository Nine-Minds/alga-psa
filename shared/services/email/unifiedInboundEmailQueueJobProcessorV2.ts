/**
 * V2 durable inbound job dispatcher. Maps V2 work types to their fenced
 * handlers and registers the Postgres lease so the consumer heartbeat renews
 * both the Redis claim and the Postgres lease together.
 */

import type { QualifiedReplyArtifactProcessor } from './qualifiedReplyArtifacts';
import type { EmailReplyAdmission } from './qualifiedReplyAdmission';
import type { InboundEmailQueueDisposition, UnifiedInboundEmailQueueJobV2 } from '../../interfaces/inbound-email.interfaces';
import type { InboundEmailDurableMode } from '../../interfaces/inbound-email.interfaces';
import type { InboundPostgresLease } from './unifiedInboundEmailQueueConsumerV2';
import {
  getInboundDurableModeForTenant,
  getDurableLeaseTtlMs,
} from './inboundEmailDurableStore';
import {
  newInboundProcessorOwner,
  processInboundInbox,
  renewInboundInboxLease,
} from './inboundEmailCoreProcessor';

export interface InboundV2JobContext {
  signal: AbortSignal;
  renew: () => Promise<boolean>;
  registerPostgresLease: (lease: InboundPostgresLease) => void;
}

/**
 * Renew the Postgres lease for a claimed inbox row. Wired as the consumer's
 * `renewPostgresLease` so the heartbeat keeps both Redis and Postgres alive.
 */
export async function renewPostgresLeaseForV2Job(
  job: UnifiedInboundEmailQueueJobV2,
  lease: InboundPostgresLease
): Promise<boolean> {
  if (job.workType !== 'process_inbox') return true;
  return renewInboundInboxLease({
    tenantId: job.tenantId,
    inboxId: lease.inboxId,
    owner: lease.owner,
    token: lease.token,
    version: lease.version,
    leaseTtlMs: getDurableLeaseTtlMs(),
  });
}

export async function processUnifiedInboundEmailDurableJob(
  job: UnifiedInboundEmailQueueJobV2,
  ctx: InboundV2JobContext,
  options: { qualifiedReplyAdmission?: EmailReplyAdmission; qualifiedReplyArtifacts?: QualifiedReplyArtifactProcessor } = {}
): Promise<InboundEmailQueueDisposition> {
  const mode = await getInboundDurableModeForTenant(job.tenantId);
  if (mode === 'off') {
    // The consumer stays live for co-managed tenants. Preserve ordinary tenants'
    // rollout choice across every V2 work type, including cursor updates and
    // artifact/outbox effects, without dropping their existing queued work.
    return { disposition: 'defer', untilIso: new Date(Date.now() + 60_000).toISOString(), reason: 'durable_mode_off' };
  }
  switch (job.workType) {
    case 'process_inbox':
      return handleProcessInbox(job, ctx, mode, options.qualifiedReplyAdmission);
    case 'stage_ingress':
      return handleStageIngress(job, ctx);
    case 'process_artifact':
      return handleProcessArtifact(job, ctx, options.qualifiedReplyArtifacts);
    case 'publish_outbox':
      return handlePublishOutbox(job, ctx);
    case 'republish_outbox_event':
      return handleRepublishOutboxEvent(job, ctx);
    default:
      return { disposition: 'retry', error: `unknown_v2_work_type:${(job as any).workType}` };
  }
}

async function handleProcessInbox(job: UnifiedInboundEmailQueueJobV2, ctx: InboundV2JobContext,
  mode: Exclude<InboundEmailDurableMode, 'off'>, qualifiedReplyAdmission?: EmailReplyAdmission): Promise<InboundEmailQueueDisposition> {
  const owner = newInboundProcessorOwner();
  return processInboundInbox({
    tenantId: job.tenantId,
    inboxId: job.recordId,
    owner,
    qualifiedReplyAdmission,
    leaseTtlMs: getDurableLeaseTtlMs(),
    mode: mode === 'enforce' ? 'enforce' : 'shadow',
    onClaim: (lease) => ctx.registerPostgresLease(lease),
  });
}

async function handleStageIngress(job: UnifiedInboundEmailQueueJobV2, ctx: InboundV2JobContext): Promise<InboundEmailQueueDisposition> {
  // Stage ingress work is emitted by producers/backfill and enqueued directly.
  // The staging path performs its own fenced claim + source upload; a scoped
  // first-draft dispatcher is wired below.
  const { processIngressStageJob } = await import('./inboundEmailIngressStagingWorker');
  return processIngressStageJob(job, ctx);
}

async function handleProcessArtifact(job: UnifiedInboundEmailQueueJobV2, ctx: InboundV2JobContext, qualifiedReplyArtifacts?: QualifiedReplyArtifactProcessor): Promise<InboundEmailQueueDisposition> {
  const { processInboundArtifactJob } = await import('./inboundEmailArtifactWorker');
  return processInboundArtifactJob(job, ctx, qualifiedReplyArtifacts);
}

async function handlePublishOutbox(job: UnifiedInboundEmailQueueJobV2, ctx: InboundV2JobContext): Promise<InboundEmailQueueDisposition> {
  const { processInboundOutboxJob } = await import('./inboundEmailOutboxDispatcher');
  return processInboundOutboxJob(job, ctx);
}

async function handleRepublishOutboxEvent(job: UnifiedInboundEmailQueueJobV2, ctx: InboundV2JobContext): Promise<InboundEmailQueueDisposition> {
  const { processInboundOutboxRepublishJob } = await import('./inboundEmailOutboxDispatcher');
  return processInboundOutboxRepublishJob(job, ctx);
}
