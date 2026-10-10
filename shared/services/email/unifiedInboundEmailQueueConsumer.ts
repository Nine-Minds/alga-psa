import { randomUUID } from 'crypto';
import type { UnifiedInboundEmailQueueJob } from '../../interfaces/inbound-email.interfaces';
import {
  ackUnifiedInboundEmailQueueJob,
  claimUnifiedInboundEmailQueueJob,
  failUnifiedInboundEmailQueueJob,
  reclaimExpiredUnifiedInboundEmailQueueJobs,
} from './unifiedInboundEmailQueue';
import { observeQueueJobDuration, recordConsumerLoopError, recordQueueJobOutcome } from './inboundEmailMetrics';

/** Loop-error backoff bounds (alga0002256): survive Redis/DB errors instead of dying. */
const LOOP_ERROR_BACKOFF_INITIAL_MS = 1_000;
const LOOP_ERROR_BACKOFF_MAX_MS = 30_000;
/** Slack added to the job timeout before the heartbeat counts as stale. */
const HEARTBEAT_STALE_SLACK_MS = 30_000;

export interface UnifiedInboundEmailQueueConsumerOptions {
  consumerId?: string;
  blockSeconds?: number;
  reclaimLimit?: number;
  pollDelayMs?: number;
  claimTtlMs?: number;
  handleJobTimeoutMs?: number;
  handleJob: (job: UnifiedInboundEmailQueueJob) => Promise<unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timeout:${label}:${timeoutMs}`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export class UnifiedInboundEmailQueueConsumer {
  private readonly consumerId: string;
  private readonly options: UnifiedInboundEmailQueueConsumerOptions;
  private readonly handleJobTimeoutMs: number;
  private running = false;
  private lastSuccessfulTickAtMs: number | null = null;
  private readonly startedAtMs = Date.now();

  constructor(options: UnifiedInboundEmailQueueConsumerOptions) {
    this.options = options;
    this.consumerId = options.consumerId || `inbound-email-consumer-${randomUUID()}`;
    this.handleJobTimeoutMs = parsePositiveInteger(
      process.env.UNIFIED_INBOUND_EMAIL_QUEUE_JOB_TIMEOUT_MS,
      options.handleJobTimeoutMs ?? 90_000
    );
  }

  public get id(): string {
    return this.consumerId;
  }

  /**
   * Epoch ms of the last `runOnce()` that completed without throwing (an empty
   * poll counts). Null until the first success. Advances on success only, so
   * both a hang and an error loop read as a stale heartbeat.
   */
  public get lastSuccessfulTickAt(): number | null {
    return this.lastSuccessfulTickAtMs;
  }

  /** A legitimately long job holds the tick up to the job timeout. */
  public get heartbeatStaleAfterMs(): number {
    return this.handleJobTimeoutMs + HEARTBEAT_STALE_SLACK_MS;
  }

  public get startedAt(): number {
    return this.startedAtMs;
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

    const jobStartedAt = Date.now();
    try {
      const result = await withTimeout(
        this.options.handleJob(claim.job),
        this.handleJobTimeoutMs,
        'unified_inbound_job'
      );
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
        recordQueueJobOutcome({ queue: 'v1', providerType: claim.job.provider, outcome: 'skip' });
      }
      await ackUnifiedInboundEmailQueueJob(claim);
      observeQueueJobDuration({
        queue: 'v1',
        providerType: claim.job.provider,
        seconds: (Date.now() - jobStartedAt) / 1000,
      });
      return true;
    } catch (error: any) {
      const reason = error?.message || String(error);
      observeQueueJobDuration({
        queue: 'v1',
        providerType: claim.job.provider,
        seconds: (Date.now() - jobStartedAt) / 1000,
      });
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

    // LEVERAGE: pattern queue-consumer-resilient-loop — identical loop in unifiedInboundEmailQueueConsumerV2.ts
    let errorBackoffMs = LOOP_ERROR_BACKOFF_INITIAL_MS;
    while (this.running) {
      try {
        const processed = await this.runOnce();
        this.lastSuccessfulTickAtMs = Date.now();
        errorBackoffMs = LOOP_ERROR_BACKOFF_INITIAL_MS;
        if (!processed && this.options.pollDelayMs && this.options.pollDelayMs > 0) {
          await sleep(this.options.pollDelayMs);
        }
      } catch (error: any) {
        recordConsumerLoopError({ queue: 'v1' });
        console.error('[UnifiedInboundEmailQueueConsumer] loop error; backing off', {
          event: 'inbound_email_queue_consumer_loop_error',
          consumerId: this.consumerId,
          backoffMs: errorBackoffMs,
          error: error?.message || String(error),
        });
        await sleep(errorBackoffMs);
        errorBackoffMs = Math.min(errorBackoffMs * 2, LOOP_ERROR_BACKOFF_MAX_MS);
      }
    }
  }

  public stop(): void {
    this.running = false;
  }
}
