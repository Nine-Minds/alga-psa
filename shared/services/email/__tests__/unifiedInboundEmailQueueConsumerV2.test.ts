import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedInboundEmailQueueJobV2 } from '../../../interfaces/inbound-email.interfaces';

function buildJob(): UnifiedInboundEmailQueueJobV2 {
  return {
    schemaVersion: 2,
    workType: 'process_inbox',
    tenantId: 'tenant-1',
    recordId: 'inbox-1',
    jobId: 'job-1',
    enqueuedAt: new Date().toISOString(),
    attempt: 0,
    maxAttempts: 5,
  };
}

function buildClaim() {
  return {
    job: buildJob(),
    originalPayload: JSON.stringify(buildJob()),
    claimToken: 'token-1',
    consumerId: 'consumer-1',
    claimedAt: new Date().toISOString(),
    leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
  };
}

async function loadConsumerModule() {
  vi.resetModules();
  const queueModule = {
    getUnifiedInboundEmailQueueV2Config: () => ({
      readyQueueKey: 'k:ready',
      processingQueueKey: 'k:processing',
      inflightHashKey: 'k:inflight',
      inflightLeaseKey: 'k:lease',
      delayedKey: 'k:delayed',
      delayedDataKey: 'k:delayed:data',
      deadLetterQueueKey: 'k:dlq',
      maxAttempts: 5,
      claimTtlMs: 120_000,
      handlerTimeoutMs: 90_000,
      heartbeatIntervalMs: 30_000,
      claimBlockSeconds: 1,
    }),
    assertDurableQueueTtlConfiguration: vi.fn(),
    reclaimExpiredInboundEmailDurableJobs: vi.fn(async () => 0),
    claimInboundEmailDurableJob: vi.fn(async () => buildClaim()),
    ackInboundEmailDurableJob: vi.fn(async () => ({ status: 'acked' })),
    failInboundEmailDurableJob: vi.fn(async () => ({ action: 'retried', attempt: 1 })),
    deferInboundEmailDurableJob: vi.fn(async () => ({ status: 'deferred' })),
    renewInboundEmailDurableQueueClaim: vi.fn(async () => true),
  };

  vi.doMock('../unifiedInboundEmailQueueV2', () => queueModule);

  const consumer = await import('../unifiedInboundEmailQueueConsumerV2');
  return { consumer, queueModule };
}

type Handler = (job: UnifiedInboundEmailQueueJobV2, ctx: any) => Promise<any>;

function makeConsumer(
  consumer: any,
  queueModule: any,
  handleJob: Handler,
  extra: { renewPostgresLease?: (job: any, lease: any) => Promise<boolean>; heartbeatMs?: number } = {}
) {
  return new consumer.UnifiedInboundEmailQueueConsumerV2({
    handleJob,
    renewPostgresLease: extra.renewPostgresLease,
    pollDelayMs: 0,
    blockSeconds: 0,
    handleJobTimeoutMs: 2000,
    heartbeatIntervalMs: extra.heartbeatMs ?? 60000,
  });
}

describe('UnifiedInboundEmailQueueConsumerV2', () => {
  beforeEach(() => {
    delete process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_JOB_TIMEOUT_MS;
    delete process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_HEARTBEAT_INTERVAL_MS;
    delete process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_CLAIM_TTL_MS;
  });

  it('acks when the handler returns an explicit ack disposition', async () => {
    const { consumer, queueModule } = await loadConsumerModule();
    const c = makeConsumer(consumer, queueModule, async () => ({ disposition: 'ack' }));
    const processed = await c.runOnce();
    expect(processed).toBe(true);
    expect(queueModule.ackInboundEmailDurableJob).toHaveBeenCalledTimes(1);
    expect(queueModule.failInboundEmailDurableJob).not.toHaveBeenCalled();
  });

  it('fails (retry) when the handler returns a retry disposition', async () => {
    const { consumer, queueModule } = await loadConsumerModule();
    const c = makeConsumer(consumer, queueModule, async () => ({ disposition: 'retry', error: 'boom' }));
    const processed = await c.runOnce();
    expect(processed).toBe(false);
    expect(queueModule.failInboundEmailDurableJob).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'boom' })
    );
    expect(queueModule.ackInboundEmailDurableJob).not.toHaveBeenCalled();
  });

  it('defers when the handler returns a defer disposition', async () => {
    const { consumer, queueModule } = await loadConsumerModule();
    const c = makeConsumer(consumer, queueModule, async () => ({
      disposition: 'defer',
      untilIso: new Date(Date.now() + 60_000).toISOString(),
    }));
    const processed = await c.runOnce();
    expect(processed).toBe(true);
    expect(queueModule.deferInboundEmailDurableJob).toHaveBeenCalledTimes(1);
    expect(queueModule.ackInboundEmailDurableJob).not.toHaveBeenCalled();
  });

  it('does not ack or fail after ownership is lost during a heartbeat', async () => {
    const { consumer, queueModule } = await loadConsumerModule();
    queueModule.renewInboundEmailDurableQueueClaim
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const c = makeConsumer(
      consumer,
      queueModule,
      async (_job, ctx) => {
        await new Promise((r) => setTimeout(r, 50));
        if (ctx.signal.aborted) throw new Error('aborted:redis_claim_lost');
        return { disposition: 'ack' };
      },
      { heartbeatMs: 20 }
    );
    const processed = await c.runOnce();
    expect(processed).toBe(false);
    expect(queueModule.ackInboundEmailDurableJob).not.toHaveBeenCalled();
    expect(queueModule.failInboundEmailDurableJob).not.toHaveBeenCalled();
  });

  it('fails the claim when the handler throws', async () => {
    const { consumer, queueModule } = await loadConsumerModule();
    const c = makeConsumer(consumer, queueModule, async () => {
      throw new Error('handler-crash');
    });
    const processed = await c.runOnce();
    expect(processed).toBe(false);
    expect(queueModule.failInboundEmailDurableJob).toHaveBeenCalledTimes(1);
  });

  it('renews the Postgres lease alongside the Redis claim on heartbeat', async () => {
    const { consumer, queueModule } = await loadConsumerModule();
    const renewPg = vi.fn(async () => true);
    const c = makeConsumer(
      consumer,
      queueModule,
      async (_job, ctx) => {
        ctx.registerPostgresLease({ inboxId: 'inbox-1', token: 't', version: 1, owner: 'o' });
        await new Promise((r) => setTimeout(r, 80));
        return { disposition: 'ack' };
      },
      { heartbeatMs: 20, renewPostgresLease: renewPg }
    );
    await c.runOnce();
    expect(renewPg).toHaveBeenCalled();
    expect(queueModule.renewInboundEmailDurableQueueClaim).toHaveBeenCalled();
  });
});
