/**
 * V2 consumer for the durable inbound email pipeline.
 *
 * - Cooperative cancellation via AbortSignal (best effort; the final Postgres
 *   fencing predicate remains the correctness boundary).
 * - Heartbeat lifecycle that renews the Redis claim AND the corresponding
 *   Postgres lease together. If either ownership check is lost, the worker
 *   stops before any fenced terminal write.
 * - Startup validation that claim TTL >= handler timeout + one heartbeat.
 * - Explicit `ack | retry | defer` dispositions returned by handlers; ACK only
 *   follows a durable terminal state.
 */

import { randomUUID } from 'node:crypto';
import type {
  ClaimedInboundEmailQueueJobV2,
  InboundEmailQueueDisposition,
  UnifiedInboundEmailQueueJobV2,
} from '../../interfaces/inbound-email.interfaces';
import {
  ackInboundEmailDurableJob,
  assertDurableQueueTtlConfiguration,
  claimInboundEmailDurableJob,
  deferInboundEmailDurableJob,
  failInboundEmailDurableJob,
  getUnifiedInboundEmailQueueV2Config,
  reclaimExpiredInboundEmailDurableJobs,
  renewInboundEmailDurableQueueClaim,
} from './unifiedInboundEmailQueueV2';

export interface UnifiedInboundEmailQueueConsumerV2Options {
  consumerId?: string;
  blockSeconds?: number;
  reclaimLimit?: number;
  pollDelayMs?: number;
  claimTtlMs?: number;
  handleJobTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  /**
   * Renew the corresponding Postgres lease; return false when ownership was lost.
   * Receives the lease registered by the handler via `ctx.registerPostgresLease`.
   */
  renewPostgresLease?: (
    job: UnifiedInboundEmailQueueJobV2,
    lease: InboundPostgresLease
  ) => Promise<boolean>;
  handleJob: (
    job: UnifiedInboundEmailQueueJobV2,
    ctx: {
      signal: AbortSignal;
      renew: () => Promise<boolean>;
      registerPostgresLease: (lease: InboundPostgresLease) => void;
    }
  ) => Promise<InboundEmailQueueDisposition | { outcome: 'skipped'; reason?: string } | void>;
}

export interface InboundPostgresLease {
  inboxId: string;
  token: string;
  version: number;
  owner: string;
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

function withTimeoutAndAbort<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  signal: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      reject(new Error(`aborted:${label}:${signal.reason || 'cancelled'}`));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      reject(new Error(`timeout:${label}:${timeoutMs}`));
    }, timeoutMs);
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        if (timer) clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        if (timer) clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export class UnifiedInboundEmailQueueConsumerV2 {
  private readonly consumerId: string;
  private readonly options: UnifiedInboundEmailQueueConsumerV2Options;
  private readonly handleJobTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private running = false;

  constructor(options: UnifiedInboundEmailQueueConsumerV2Options) {
    this.options = options;
    this.consumerId = options.consumerId || `inbound-email-v2-consumer-${randomUUID()}`;
    this.handleJobTimeoutMs = parsePositiveInteger(
      process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_JOB_TIMEOUT_MS,
      options.handleJobTimeoutMs ?? getUnifiedInboundEmailQueueV2Config().handlerTimeoutMs
    );
    this.heartbeatIntervalMs = parsePositiveInteger(
      process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_HEARTBEAT_INTERVAL_MS,
      options.heartbeatIntervalMs ?? getUnifiedInboundEmailQueueV2Config().heartbeatIntervalMs
    );
    // Fail fast on a TTL/timeout configuration that recreates the original
    // lease-loss incident instead of discovering it after message loss.
    assertDurableQueueTtlConfiguration();
  }

  public get id(): string {
    return this.consumerId;
  }

  public async runOnce(): Promise<boolean> {
    await reclaimExpiredInboundEmailDurableJobs(this.options.reclaimLimit ?? 20);

    const claim = await claimInboundEmailDurableJob({
      consumerId: this.consumerId,
      blockSeconds: this.options.blockSeconds ?? 1,
      claimTtlMs: this.options.claimTtlMs,
    });

    if (!claim) {
      return false;
    }

    return this.processClaim(claim);
  }

  private async processClaim(claim: ClaimedInboundEmailQueueJobV2): Promise<boolean> {
    const controller = new AbortController();
    let ownershipLost = false;
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let currentPostgresLease: InboundPostgresLease | null = null;

    const registerPostgresLease = (lease: InboundPostgresLease) => {
      currentPostgresLease = lease;
    };

    const renew = async (): Promise<boolean> => {
      if (ownershipLost) return false;
      const redisOk = await renewInboundEmailDurableQueueClaim(claim);
      if (!redisOk) {
        ownershipLost = true;
        controller.abort(new Error('redis_claim_lost'));
        return false;
      }
      if (this.options.renewPostgresLease && currentPostgresLease) {
        const dbOk = await this.options.renewPostgresLease(claim.job, currentPostgresLease);
        if (!dbOk) {
          ownershipLost = true;
          controller.abort(new Error('postgres_lease_lost'));
          return false;
        }
      }
      return true;
    };

    const startHeartbeat = () => {
      if (heartbeatTimer) return;
      heartbeatTimer = setInterval(() => {
        renew().catch((error) => {
          console.error('[UnifiedInboundEmailQueueConsumerV2] heartbeat renewal failed', {
            event: 'inbound_email_queue_v2_heartbeat_error',
            jobId: claim.job.jobId,
            consumerId: this.consumerId,
            error: error instanceof Error ? error.message : String(error),
          });
          ownershipLost = true;
          controller.abort(new Error('heartbeat_renewal_failed'));
        });
      }, this.heartbeatIntervalMs);
      if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
    };

    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    startHeartbeat();

    try {
      const result = await withTimeoutAndAbort(
        Promise.resolve().then(() =>
          this.options.handleJob(claim.job, { signal: controller.signal, renew, registerPostgresLease })
        ),
        this.handleJobTimeoutMs,
        'unified_inbound_job_v2',
        controller.signal
      );

      stopHeartbeat();
      if (ownershipLost) {
        console.warn('[UnifiedInboundEmailQueueConsumerV2] ownership lost before disposition; dropping job', {
          event: 'inbound_email_queue_v2_ownership_lost',
          jobId: claim.job.jobId,
          consumerId: this.consumerId,
          workType: claim.job.workType,
        });
        return false;
      }

      const disposition = resolveDisposition(result);
      switch (disposition.disposition) {
        case 'retry':
          await failInboundEmailDurableJob({ claim, error: disposition.error });
          return false;
        case 'defer':
          await deferInboundEmailDurableJob({
            claim,
            untilIso: disposition.untilIso,
            reason: disposition.reason,
          });
          return true;
        case 'ack':
        default:
          await ackInboundEmailDurableJob(claim);
          return true;
      }
    } catch (error: any) {
      stopHeartbeat();
      const reason = error?.message || String(error);
      if (ownershipLost) {
        console.warn('[UnifiedInboundEmailQueueConsumerV2] handling aborted after ownership loss; not failing claim', {
          event: 'inbound_email_queue_v2_ownership_lost_abort',
          jobId: claim.job.jobId,
          consumerId: this.consumerId,
          reason,
        });
        return false;
      }
      const result = await failInboundEmailDurableJob({ claim, error: reason });
      console.error('[UnifiedInboundEmailQueueConsumerV2] Job failed', {
        event: 'inbound_email_queue_v2_job_failed',
        consumerId: this.consumerId,
        jobId: claim.job.jobId,
        workType: claim.job.workType,
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

function resolveDisposition(
  result: InboundEmailQueueDisposition | { outcome: 'skipped'; reason?: string } | void
): InboundEmailQueueDisposition {
  if (!result) {
    // A handler that completes without an explicit disposition is treated as a
    // successful terminal write — ACK.
    return { disposition: 'ack' };
  }
  if ('disposition' in result) {
    return result;
  }
  // Legacy `{ outcome: 'skipped' }` result: an intentional skip is terminal.
  return { disposition: 'ack' };
}
