import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaimedInboundEmailQueueJobV2 } from '../../../interfaces/inbound-email.interfaces';

function createRedisClientMock() {
  const client: any = {
    on: vi.fn(),
    connect: vi.fn(async () => undefined),
    rPush: vi.fn(async () => 1),
    eval: vi.fn(async () => JSON.stringify({ status: 'empty' })),
    multi: vi.fn(() => ({ exec: vi.fn(async () => []) })),
  };
  return { client };
}

function buildV2Claim(overrides?: Partial<ClaimedInboundEmailQueueJobV2>): ClaimedInboundEmailQueueJobV2 {
  return {
    job: {
      schemaVersion: 2,
      workType: 'process_inbox',
      tenantId: 'tenant-1',
      recordId: 'inbox-1',
      jobId: 'job-1',
      enqueuedAt: new Date().toISOString(),
      attempt: 0,
      maxAttempts: 5,
    },
    originalPayload: JSON.stringify({
      schemaVersion: 2,
      workType: 'process_inbox',
      tenantId: 'tenant-1',
      recordId: 'inbox-1',
      jobId: 'job-1',
      enqueuedAt: new Date().toISOString(),
      attempt: 0,
      maxAttempts: 5,
    }),
    claimToken: 'token-1',
    consumerId: 'consumer-1',
    claimedAt: new Date().toISOString(),
    leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
    ...(overrides || {}),
  };
}

async function loadQueueV2Module() {
  vi.resetModules();
  const { client } = createRedisClientMock();

  vi.doMock('redis', () => ({
    createClient: vi.fn(() => client),
  }));
  vi.doMock('@alga-psa/core/secrets', () => ({
    getSecret: vi.fn(async () => null),
  }));

  const module = await import('../unifiedInboundEmailQueueV2');
  return { module, client };
}

describe('V2 durable inbound queue primitives', () => {
  beforeEach(() => {
    delete process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_CLAIM_TTL_MS;
    delete process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_JOB_TIMEOUT_MS;
    delete process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_HEARTBEAT_INTERVAL_MS;
    delete process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_READY_KEY;
    delete process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_PROCESSING_KEY;
    delete process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_INFLIGHT_HASH_KEY;
    delete process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_INFLIGHT_LEASE_KEY;
    delete process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_DELAYED_KEY;
    delete process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_DELAYED_DATA_KEY;
    delete process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_DLQ_KEY;
    delete process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_MAX_ATTEMPTS;
  });

  it('startup validation fails fast on the old 60/90 TTL mismatch', async () => {
    const { module } = await loadQueueV2Module();
    process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_CLAIM_TTL_MS = '60000';
    process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_JOB_TIMEOUT_MS = '90000';
    process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_HEARTBEAT_INTERVAL_MS = '30000';
    expect(() => module.assertDurableQueueTtlConfiguration()).toThrow(/claim TTL/);
  });

  it('startup validation passes when TTL >= timeout + one heartbeat', async () => {
    const { module } = await loadQueueV2Module();
    process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_CLAIM_TTL_MS = '120000';
    process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_JOB_TIMEOUT_MS = '90000';
    process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_HEARTBEAT_INTERVAL_MS = '30000';
    expect(() => module.assertDurableQueueTtlConfiguration()).not.toThrow();
  });

  it('enqueue writes a V2 payload (work type + durable ids only)', async () => {
    const { module, client } = await loadQueueV2Module();
    const result = await module.enqueueInboundEmailDurableJob({
      workType: 'process_inbox',
      tenantId: 'tenant-1',
      recordId: 'inbox-1',
    });
    expect(result.job.schemaVersion).toBe(2);
    expect(client.rPush).toHaveBeenCalledTimes(1);
    const pushed = client.rPush.mock.calls[0][1];
    expect(typeof pushed).toBe('string');
    const parsed = JSON.parse(pushed);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.workType).toBe('process_inbox');
    expect(parsed.tenantId).toBe('tenant-1');
    expect(parsed.recordId).toBe('inbox-1');
    expect(parsed.jobId).toBeTruthy();
    expect(parsed.payload).toBeUndefined();
  });

  it('claim passes a per-claim claim token into the Lua script', async () => {
    const { module, client } = await loadQueueV2Module();
    client.eval.mockResolvedValue(JSON.stringify({
      status: 'claimed',
      claim: JSON.stringify({
        job: { jobId: 'job-1' },
        originalPayload: '{}',
        claimToken: 'token-x',
        consumerId: 'consumer-1',
        claimedAt: new Date().toISOString(),
        leaseExpiresAt: new Date(Date.now() + 120000).toISOString(),
      }),
    }));
    const claim = await module.claimInboundEmailDurableJob({ consumerId: 'consumer-1', blockSeconds: 0 });
    expect(claim).toBeTruthy();
    expect(claim.claimToken).toBe('token-x');
    const claimCalls = client.eval.mock.calls.filter((call: any) => (call[1]?.keys?.length ?? 0) === 5);
    const args = claimCalls.at(-1)[1].arguments;
    expect(typeof args[6]).toBe('string');
    expect(String(args[6]).length).toBeGreaterThan(0);
  });

  it('ack with a stale claim token returns noop (owner-fenced ACK)', async () => {
    const { module, client } = await loadQueueV2Module();
    client.eval.mockResolvedValue(JSON.stringify({ status: 'noop', reason: 'stale_token' }));
    const result = await module.ackInboundEmailDurableJob(buildV2Claim());
    expect(result.status).toBe('noop');
  });

  it('fail with a stale claim token returns noop and does not requeue', async () => {
    const { module, client } = await loadQueueV2Module();
    client.eval.mockResolvedValue(JSON.stringify({ status: 'noop', reason: 'stale_token' }));
    const result = await module.failInboundEmailDurableJob({ claim: buildV2Claim(), error: 'boom' });
    expect(result.action).toBe('noop');
  });

  it('fail passes a timestamp for the DLQ entry (no os.time in the Redis sandbox)', async () => {
    const { module, client } = await loadQueueV2Module();
    client.eval.mockResolvedValue(JSON.stringify({ status: 'dlq', attempt: 5 }));
    const result = await module.failInboundEmailDurableJob({ claim: buildV2Claim(), error: 'exhausted' });
    expect(result.action).toBe('dlq');
    // The FAIL script now takes failedAt as ARGV[5] instead of calling
    // os.time(), which is not available in the Redis Lua sandbox and aborted
    // the script after the processing-list removal (stranding the job forever).
    const failCalls = client.eval.mock.calls.filter((call: any) => (call[1]?.keys?.length ?? 0) === 5);
    const args = failCalls.at(-1)[1].arguments;
    expect(args.length).toBeGreaterThanOrEqual(5);
    expect(new Date(String(args[4])).getTime()).not.toBeNaN();
  });

  it('defer moves the job to the delayed set until the DB lease expiry', async () => {
    const { module, client } = await loadQueueV2Module();
    client.eval.mockResolvedValue(JSON.stringify({ status: 'deferred', untilMs: 123456 }));
    const untilIso = new Date(Date.now() + 120_000).toISOString();
    const result = await module.deferInboundEmailDurableJob({ claim: buildV2Claim(), untilIso });
    expect(result.status).toBe('deferred');
    expect(client.eval).toHaveBeenCalled();
  });

  it('renew returns false when the claim token is stale', async () => {
    const { module, client } = await loadQueueV2Module();
    client.eval.mockResolvedValue(JSON.stringify({ status: 'noop', reason: 'stale_token' }));
    const ok = await module.renewInboundEmailDurableQueueClaim(buildV2Claim());
    expect(ok).toBe(false);
  });

  it('reclaim moves expired claims back to ready atomically in Lua', async () => {
    const { module, client } = await loadQueueV2Module();
    client.eval.mockResolvedValue(JSON.stringify({ status: 'done', reclaimed: 2 }));
    const count = await module.reclaimExpiredInboundEmailDurableJobs(10);
    expect(count).toBe(2);
  });

  it('pump moves due delayed jobs to ready', async () => {
    const { module, client } = await loadQueueV2Module();
    client.eval.mockResolvedValue(JSON.stringify({ status: 'done', pumped: 3 }));
    const count = await module.pumpDueDelayedInboundEmailDurableJobs();
    expect(count).toBe(3);
  });
});
