import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaimedUnifiedInboundEmailQueueJob } from '../unifiedInboundEmailQueue';

function createRedisClientMock() {
  const chain: any = {
    lRem: vi.fn(() => chain),
    hDel: vi.fn(() => chain),
    zRem: vi.fn(() => chain),
    rPush: vi.fn(() => chain),
    hSet: vi.fn(() => chain),
    zAdd: vi.fn(() => chain),
    exec: vi.fn(async () => []),
  };

  const client: any = {
    on: vi.fn(),
    connect: vi.fn(async () => undefined),
    rPush: vi.fn(async () => 1),
    brPopLPush: vi.fn(async () => null),
    multi: vi.fn(() => chain),
    zRangeByScore: vi.fn(async () => []),
    hGet: vi.fn(async () => null),
    zRem: vi.fn(async () => 1),
  };

  return { client, chain };
}

function buildClaim(overrides?: Partial<ClaimedUnifiedInboundEmailQueueJob>): ClaimedUnifiedInboundEmailQueueJob {
  const baseJob = {
    jobId: 'job-1',
    schemaVersion: 1 as const,
    tenantId: 'tenant-1',
    providerId: 'provider-1',
    provider: 'microsoft' as const,
    pointer: {
      subscriptionId: 'sub-1',
      messageId: 'msg-1',
    },
    enqueuedAt: new Date().toISOString(),
    attempt: 0,
    maxAttempts: 5,
  };

  return {
    job: baseJob,
    originalPayload: JSON.stringify(baseJob),
    consumerId: 'consumer-1',
    claimedAt: new Date().toISOString(),
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...(overrides || {}),
  } as ClaimedUnifiedInboundEmailQueueJob;
}

async function loadQueueModule() {
  vi.resetModules();

  const { client, chain } = createRedisClientMock();

  vi.doMock('redis', () => ({
    createClient: vi.fn(() => client),
  }));

  vi.doMock('@alga-psa/core/secrets', () => ({
    getSecret: vi.fn(async () => null),
  }));

  const module = await import('../unifiedInboundEmailQueue');
  return { module, client, chain };
}

describe('Unified inbound pointer queue primitives', () => {
  beforeEach(() => {
    delete process.env.UNIFIED_INBOUND_EMAIL_QUEUE_KEY;
    delete process.env.UNIFIED_INBOUND_EMAIL_PROCESSING_QUEUE_KEY;
    delete process.env.UNIFIED_INBOUND_EMAIL_INFLIGHT_HASH_KEY;
    delete process.env.UNIFIED_INBOUND_EMAIL_INFLIGHT_LEASE_KEY;
    delete process.env.UNIFIED_INBOUND_EMAIL_DLQ_KEY;
    delete process.env.UNIFIED_INBOUND_EMAIL_QUEUE_MAX_ATTEMPTS;
  });

  it('T018: successful processing ACK removes the job from processing/inflight structures', async () => {
    const { module, chain } = await loadQueueModule();
    const claim = buildClaim();

    await module.ackUnifiedInboundEmailQueueJob(claim);

    expect(chain.lRem).toHaveBeenCalledWith('email:inbound:unified:pointer:processing', 1, claim.originalPayload);
    expect(chain.hDel).toHaveBeenCalledWith('email:inbound:unified:pointer:inflight', claim.job.jobId);
    expect(chain.zRem).toHaveBeenCalledWith('email:inbound:unified:pointer:lease', claim.job.jobId);
    expect(chain.exec).toHaveBeenCalledTimes(1);
  });

  it('T020: unacknowledged jobs are reclaimed after lease timeout and resurfaced to ready queue', async () => {
    const { module, client, chain } = await loadQueueModule();
    const claim = buildClaim();

    client.zRangeByScore.mockResolvedValueOnce([claim.job.jobId]);
    client.hGet.mockResolvedValueOnce(JSON.stringify(claim));

    const reclaimed = await module.reclaimExpiredUnifiedInboundEmailQueueJobs(10);

    expect(reclaimed).toBe(1);
    expect(chain.lRem).toHaveBeenCalledWith('email:inbound:unified:pointer:processing', 1, claim.originalPayload);
    expect(chain.hDel).toHaveBeenCalledWith('email:inbound:unified:pointer:inflight', claim.job.jobId);
    expect(chain.zRem).toHaveBeenCalledWith('email:inbound:unified:pointer:lease', claim.job.jobId);
    expect(chain.rPush).toHaveBeenCalledWith('email:inbound:unified:pointer:ready', claim.originalPayload);
  });

  it('T021: failed consume increments attempt count when requeued', async () => {
    const { module, client } = await loadQueueModule();
    const claim = buildClaim({
      job: {
        ...buildClaim().job,
        attempt: 1,
        maxAttempts: 5,
      },
    });

    client.rPush.mockResolvedValueOnce(4);
    const result = await module.failUnifiedInboundEmailQueueJob({
      claim,
      error: 'temporary_failure',
    });

    expect(result).toMatchObject({
      action: 'retried',
      attempt: 2,
      queueDepth: 4,
    });

    const [, requeuedPayloadRaw] = client.rPush.mock.calls[0];
    const requeuedPayload = JSON.parse(requeuedPayloadRaw);
    expect(requeuedPayload.attempt).toBe(2);
  });

  it('T022: failed consume moves job to DLQ when max attempts are exceeded', async () => {
    const { module, client } = await loadQueueModule();
    const claim = buildClaim({
      job: {
        ...buildClaim().job,
        attempt: 4,
        maxAttempts: 5,
      },
    });

    client.rPush.mockResolvedValueOnce(2);
    const result = await module.failUnifiedInboundEmailQueueJob({
      claim,
      error: 'permanent_failure',
    });

    expect(result).toMatchObject({
      action: 'dlq',
      attempt: 5,
      queueDepth: 2,
    });

    const [dlqKey, dlqPayloadRaw] = client.rPush.mock.calls[0];
    expect(dlqKey).toBe('email:inbound:unified:pointer:dlq');
    const dlqPayload = JSON.parse(dlqPayloadRaw);
    expect(dlqPayload).toMatchObject({
      reason: 'permanent_failure',
      job: expect.objectContaining({
        attempt: 5,
      }),
    });
  });

  it('T025: queue payload guard rejects raw MIME and attachment-like fields', async () => {
    const { module } = await loadQueueModule();

    await expect(
      module.enqueueUnifiedInboundEmailQueueJob({
        tenantId: 'tenant-1',
        providerId: 'provider-1',
        provider: 'microsoft',
        pointer: {
          subscriptionId: 'sub-1',
          messageId: 'msg-1',
        },
        // Explicitly violating pointer-only contract.
        ...( { emailData: { id: 'msg-1' } } as any),
      })
    ).rejects.toThrow('pointer-only');
  });

  it('T032: enqueue success/failure logs include tenant/provider/pointer identifiers', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { module, client } = await loadQueueModule();

    client.rPush.mockResolvedValueOnce(1);
    await module.enqueueUnifiedInboundEmailQueueJob({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      provider: 'microsoft',
      pointer: {
        subscriptionId: 'sub-1',
        messageId: 'msg-1',
      },
    });

    client.rPush.mockRejectedValueOnce(new Error('redis down'));
    await expect(
      module.enqueueUnifiedInboundEmailQueueJob({
        tenantId: 'tenant-1',
        providerId: 'provider-1',
        provider: 'microsoft',
        pointer: {
          subscriptionId: 'sub-1',
          messageId: 'msg-2',
        },
      })
    ).rejects.toThrow('redis down');

    expect(logSpy).toHaveBeenCalledWith(
      '[UnifiedInboundEmailQueue] enqueue',
      expect.objectContaining({
        event: 'inbound_email_queue_enqueue',
        tenantId: 'tenant-1',
        provider: 'microsoft',
        pointerMessageId: 'msg-1',
      })
    );
    expect(errorSpy).toHaveBeenCalledWith(
      '[UnifiedInboundEmailQueue] enqueue_failed',
      expect.objectContaining({
        event: 'inbound_email_queue_enqueue_failed',
        tenantId: 'tenant-1',
        provider: 'microsoft',
        pointerMessageId: 'msg-2',
      })
    );

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('T033: retry and DLQ logs include attempts and terminal reasons', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { module, client } = await loadQueueModule();

    client.rPush.mockResolvedValueOnce(1);
    await module.failUnifiedInboundEmailQueueJob({
      claim: buildClaim(),
      error: 'transient_error',
    });

    client.rPush.mockResolvedValueOnce(2);
    await module.failUnifiedInboundEmailQueueJob({
      claim: buildClaim({
        job: {
          ...buildClaim().job,
          attempt: 4,
          maxAttempts: 5,
        },
      }),
      error: 'terminal_error',
    });

    expect(warnSpy).toHaveBeenCalledWith(
      '[UnifiedInboundEmailQueue] retry',
      expect.objectContaining({
        event: 'inbound_email_queue_retry',
        attempt: 1,
        maxAttempts: 5,
        reason: 'transient_error',
      })
    );
    expect(errorSpy).toHaveBeenCalledWith(
      '[UnifiedInboundEmailQueue] dlq',
      expect.objectContaining({
        event: 'inbound_email_queue_dlq',
        attempt: 5,
        maxAttempts: 5,
        reason: 'terminal_error',
      })
    );

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
