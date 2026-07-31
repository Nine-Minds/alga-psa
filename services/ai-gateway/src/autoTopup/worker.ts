import process from 'node:process';

import type { Knex } from 'knex';

import type { AiAccountRow, AutoTopupJobRow } from '../db/types.js';
import type { GatewayEventEmitter } from '../events/events.js';
import type { GatewayStripeClient } from '../stripe/stripeClient.js';
import { resolveTopupPack, type TierConfigLoader } from '../tier/tierConfig.js';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_MS = 60_000;
const DEFAULT_PROCESSING_LEASE_MS = 5 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

interface ClaimedAutoTopupJob {
  job: AutoTopupJobRow;
  account: AiAccountRow;
}

export interface AutoTopupWorkerOptions {
  database: Knex;
  stripe: GatewayStripeClient;
  getTierConfig: TierConfigLoader;
  events: GatewayEventEmitter;
  maxAttempts?: number;
  retryBaseMs?: number;
  processingLeaseMs?: number;
  now?: () => Date;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

export class AutoTopupWorker {
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly processingLeaseMs: number;
  private readonly now: () => Date;

  constructor(private readonly options: AutoTopupWorkerOptions) {
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    this.processingLeaseMs = options.processingLeaseMs ?? DEFAULT_PROCESSING_LEASE_MS;
    this.now = options.now ?? (() => new Date());
  }

  async runOnce(): Promise<boolean> {
    const claimed = await this.claimNextJob();
    if (!claimed) {
      return false;
    }

    try {
      if (!claimed.account.auto_topup_enabled) {
        await this.markInactiveJobFailed(claimed.job.job_id, 'Auto top-up was disabled');
        return true;
      }
      if (!claimed.account.stripe_customer_id) {
        throw new Error('AI account has no Stripe customer for auto top-up');
      }
      resolveTopupPack(await this.options.getTierConfig(), claimed.job.pack_price_id);
      const paymentIntent = await this.options.stripe.createAutoTopupPaymentIntent({
        jobId: claimed.job.job_id,
        attempt: claimed.job.attempt_count,
        customerId: claimed.account.stripe_customer_id,
        priceId: claimed.job.pack_price_id,
        tenantId: claimed.account.tenant_id,
        deploymentType: claimed.account.deployment_type,
        accountId: claimed.account.account_id,
      });
      if (paymentIntent.status !== 'succeeded' && paymentIntent.status !== 'processing') {
        throw new Error(`Stripe PaymentIntent entered ${paymentIntent.status}`);
      }

      await this.options.database('auto_topup_jobs')
        .where({ job_id: claimed.job.job_id, status: 'processing' })
        .update({
          status: 'awaiting_webhook',
          payment_intent_id: paymentIntent.id,
          locked_at: null,
          updated_at: this.now(),
        });
    } catch (error) {
      await recordAutoTopupFailure({
        database: this.options.database,
        jobId: claimed.job.job_id,
        error: safeErrorMessage(error),
        maxAttempts: this.maxAttempts,
        retryBaseMs: this.retryBaseMs,
        events: this.options.events,
        now: this.now,
      });
    }
    return true;
  }

  private async claimNextJob(): Promise<ClaimedAutoTopupJob | undefined> {
    const now = this.now();
    const staleBefore = new Date(now.getTime() - this.processingLeaseMs);
    return this.options.database.transaction(async (transaction) => {
      const job = await transaction<AutoTopupJobRow>('auto_topup_jobs')
        .where((query) => {
          query
            .where((pending) => {
              pending.where({ status: 'pending' }).andWhere('next_attempt_at', '<=', now);
            })
            .orWhere((stale) => {
              stale.where({ status: 'processing' }).andWhere('locked_at', '<=', staleBefore);
            });
        })
        .orderBy('next_attempt_at', 'asc')
        .forUpdate()
        .skipLocked()
        .first();
      if (!job) {
        return undefined;
      }

      const attemptCount = job.attempt_count + 1;
      await transaction('auto_topup_jobs').where({ job_id: job.job_id }).update({
        status: 'processing',
        attempt_count: attemptCount,
        locked_at: now,
        updated_at: now,
      });
      const account = await transaction<AiAccountRow>('ai_accounts')
        .where({ account_id: job.account_id })
        .first();
      if (!account) {
        throw new Error(`Auto top-up account ${job.account_id} does not exist`);
      }
      return { job: { ...job, status: 'processing', attempt_count: attemptCount }, account };
    });
  }

  private async markInactiveJobFailed(jobId: string, error: string): Promise<void> {
    await this.options.database('auto_topup_jobs')
      .where({ job_id: jobId, status: 'processing' })
      .update({
        status: 'failed',
        last_error: error,
        locked_at: null,
        completed_at: this.now(),
        updated_at: this.now(),
      });
  }
}

export async function recordAutoTopupFailure(options: {
  database: Knex;
  jobId: string;
  error: string;
  maxAttempts: number;
  retryBaseMs: number;
  events: GatewayEventEmitter;
  now?: () => Date;
}): Promise<void> {
  const now = options.now?.() ?? new Date();
  const outcome = await options.database.transaction(async (transaction) => {
    const job = await transaction<AutoTopupJobRow>('auto_topup_jobs')
      .where({ job_id: options.jobId })
      .forUpdate()
      .first();
    if (!job || (job.status !== 'processing' && job.status !== 'awaiting_webhook')) {
      return undefined;
    }
    const account = await transaction<AiAccountRow>('ai_accounts')
      .where({ account_id: job.account_id })
      .forUpdate()
      .first();
    if (!account) {
      throw new Error(`Auto top-up account ${job.account_id} does not exist`);
    }

    const disabled = job.attempt_count >= options.maxAttempts;
    const failureCount = account.auto_topup_failure_count + 1;
    await transaction('ai_accounts').where({ account_id: account.account_id }).update({
      auto_topup_enabled: disabled ? false : account.auto_topup_enabled,
      auto_topup_failure_count: failureCount,
      updated_at: now,
    });
    await transaction('auto_topup_jobs').where({ job_id: job.job_id }).update(
      disabled
        ? {
            status: 'failed',
            last_error: options.error,
            locked_at: null,
            completed_at: now,
            updated_at: now,
          }
        : {
            status: 'pending',
            last_error: options.error,
            locked_at: null,
            next_attempt_at: new Date(
              now.getTime() + options.retryBaseMs * 2 ** (job.attempt_count - 1),
            ),
            updated_at: now,
          },
    );
    return { account, job, disabled, failureCount };
  });
  if (!outcome) {
    return;
  }

  const common = {
    accountId: outcome.account.account_id,
    tenantId: outcome.account.tenant_id,
    deploymentType: outcome.account.deployment_type,
  };
  options.events.emit({
    type: 'auto_topup_failed',
    ...common,
    details: {
      jobId: outcome.job.job_id,
      attempt: outcome.job.attempt_count.toString(),
      maxAttempts: options.maxAttempts.toString(),
    },
  });
  if (outcome.disabled) {
    options.events.emit({
      type: 'auto_topup_disabled',
      ...common,
      details: {
        jobId: outcome.job.job_id,
        failureCount: outcome.failureCount.toString(),
      },
    });
  }
}

export interface AutoTopupPoller {
  stop(): void;
}

export function startAutoTopupPoller(worker: AutoTopupWorker): AutoTopupPoller {
  const intervalMs = positiveInteger(
    process.env.AI_GATEWAY_AUTO_TOPUP_POLL_INTERVAL_MS,
    DEFAULT_POLL_INTERVAL_MS,
    'AI_GATEWAY_AUTO_TOPUP_POLL_INTERVAL_MS',
  );
  const run = (): void => {
    void worker.runOnce().catch((error: unknown) => {
      console.error('[ai-gateway] Auto top-up poll failed', error);
    });
  };
  run();
  const interval = setInterval(run, intervalMs);
  interval.unref();
  return { stop: () => clearInterval(interval) };
}

export function createAutoTopupWorkerFromEnvironment(options: {
  database: Knex;
  stripe: GatewayStripeClient;
  getTierConfig: TierConfigLoader;
  events: GatewayEventEmitter;
}): AutoTopupWorker {
  return new AutoTopupWorker({
    ...options,
    maxAttempts: positiveInteger(
      process.env.AI_GATEWAY_AUTO_TOPUP_MAX_ATTEMPTS,
      DEFAULT_MAX_ATTEMPTS,
      'AI_GATEWAY_AUTO_TOPUP_MAX_ATTEMPTS',
    ),
    retryBaseMs: positiveInteger(
      process.env.AI_GATEWAY_AUTO_TOPUP_RETRY_BASE_MS,
      DEFAULT_RETRY_BASE_MS,
      'AI_GATEWAY_AUTO_TOPUP_RETRY_BASE_MS',
    ),
  });
}
