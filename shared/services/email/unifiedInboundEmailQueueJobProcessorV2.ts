/**
 * V2 durable inbound job dispatcher. Maps V2 work types to their fenced
 * handlers and registers the Postgres lease so the consumer heartbeat renews
 * both the Redis claim and the Postgres lease together.
 */

import type { InboundEmailQueueDisposition, UnifiedInboundEmailQueueJobV2 } from '../../interfaces/inbound-email.interfaces';
import type { InboundPostgresLease } from './unifiedInboundEmailQueueConsumerV2';
import {
  getInboundDurableMode,
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
  ctx: InboundV2JobContext
): Promise<InboundEmailQueueDisposition> {
  switch (job.workType) {
    case 'process_inbox':
      return handleProcessInbox(job, ctx);
    case 'stage_ingress':
      return handleStageIngress(job, ctx);
    case 'process_artifact':
      return handleProcessArtifact(job, ctx);
    case 'publish_outbox':
      return handlePublishOutbox(job, ctx);
    default:
      return { disposition: 'retry', error: `unknown_v2_work_type:${(job as any).workType}` };
  }
}

async function handleProcessInbox(job: UnifiedInboundEmailQueueJobV2, ctx: InboundV2JobContext): Promise<InboundEmailQueueDisposition> {
  const mode = getInboundDurableMode();
  if (mode === 'off') {
    // Enforce/off plumbing: without a durable processor, nothing to do here —
    // the V1 path remains authoritative.
    return { disposition: 'ack' };
  }
  const owner = newInboundProcessorOwner();
  return processInboundInbox({
    tenantId: job.tenantId,
    inboxId: job.recordId,
    owner,
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

async function handleProcessArtifact(job: UnifiedInboundEmailQueueJobV2, ctx: InboundV2JobContext): Promise<InboundEmailQueueDisposition> {
  const { processInboundArtifactJob } = await import('./inboundEmailArtifactWorker');
  return processInboundArtifactJob(job, ctx);
}

async function handlePublishOutbox(job: UnifiedInboundEmailQueueJobV2, ctx: InboundV2JobContext): Promise<InboundEmailQueueDisposition> {
  const { processInboundOutboxJob } = await import('./inboundEmailOutboxDispatcher');
  return processInboundOutboxJob(job, ctx);
}
