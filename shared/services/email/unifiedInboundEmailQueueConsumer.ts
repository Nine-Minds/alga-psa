import { randomUUID } from 'crypto';
import type { UnifiedInboundEmailQueueJob } from '../../interfaces/inbound-email.interfaces';
import {
  ackUnifiedInboundEmailQueueJob,
  claimUnifiedInboundEmailQueueJob,
  failUnifiedInboundEmailQueueJob,
  reclaimExpiredUnifiedInboundEmailQueueJobs,
} from './unifiedInboundEmailQueue';

export interface UnifiedInboundEmailQueueConsumerOptions {
  consumerId?: string;
  blockSeconds?: number;
  reclaimLimit?: number;
  pollDelayMs?: number;
  claimTtlMs?: number;
  handleJob: (job: UnifiedInboundEmailQueueJob) => Promise<unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class UnifiedInboundEmailQueueConsumer {
  private readonly consumerId: string;
  private readonly options: UnifiedInboundEmailQueueConsumerOptions;
  private running = false;

  constructor(options: UnifiedInboundEmailQueueConsumerOptions) {
    this.options = options;
    this.consumerId = options.consumerId || `inbound-email-consumer-${randomUUID()}`;
  }

  public get id(): string {
    return this.consumerId;
  }

  public async runOnce(): Promise<boolean> {
    await reclaimExpiredUnifiedInboundEmailQueueJobs(this.options.reclaimLimit ?? 20);

    const claim = await claimUnifiedInboundEmailQueueJob({
      consumerId: this.consumerId,
      blockSeconds: this.options.blockSeconds ?? 1,
      claimTtlMs: this.options.claimTtlMs,
    });

    if (!claim) {
      return false;
    }

    try {
      const result = await this.options.handleJob(claim.job);
      const resultAsAny = result as any;
      if (
        resultAsAny &&
        typeof resultAsAny === 'object' &&
        typeof resultAsAny.outcome === 'string' &&
        resultAsAny.outcome === 'skipped'
      ) {
        console.warn('[UnifiedInboundEmailQueueConsumer] Job skipped', {
          event: 'inbound_email_queue_skip',
          consumerId: this.consumerId,
          jobId: claim.job.jobId,
          provider: claim.job.provider,
          tenantId: claim.job.tenantId,
          attempt: claim.job.attempt,
          reason:
            typeof resultAsAny.reason === 'string' && resultAsAny.reason.length > 0
              ? resultAsAny.reason
              : null,
        });
      }
      await ackUnifiedInboundEmailQueueJob(claim);
      return true;
    } catch (error: any) {
      const reason = error?.message || String(error);
      const result = await failUnifiedInboundEmailQueueJob({
        claim,
        error: reason,
      });
      console.error('[UnifiedInboundEmailQueueConsumer] Job failed', {
        consumerId: this.consumerId,
        jobId: claim.job.jobId,
        provider: claim.job.provider,
        tenantId: claim.job.tenantId,
        attempt: result.attempt,
        action: result.action,
        reason,
      });
      return false;
    }
  }

  public async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    while (this.running) {
      const processed = await this.runOnce();
      if (!processed && this.options.pollDelayMs && this.options.pollDelayMs > 0) {
        await sleep(this.options.pollDelayMs);
      }
    }
  }

  public stop(): void {
    this.running = false;
  }
}
