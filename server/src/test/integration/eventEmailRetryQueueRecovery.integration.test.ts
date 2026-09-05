import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';

vi.unmock('redis');
const send = vi.hoisted(() => vi.fn());
vi.mock('@/lib/notifications/sendEventEmail', () => ({ sendEventEmail: send }));
import { EventEmailRetryQueue } from '@/lib/notifications/EventEmailRetryQueue';

// Opt in against a local Redis instance. Every test owns and removes a random key prefix.
describe.runIf(process.env.REAL_REDIS === '1' && Boolean(process.env.TEST_REDIS_URL))('event email retry processing leases (Redis)', () => {
  let redis: ReturnType<typeof createClient>;
  beforeAll(async () => {
    redis = createClient({ url: process.env.TEST_REDIS_URL, password: process.env.REDIS_PASSWORD });
    await redis.connect();
  });
  afterAll(async () => { await redis?.quit(); });

  async function withQueue(test: (queue: any, prefix: string) => Promise<void>) {
    const prefix = `attachment-queue-test:${randomUUID()}:`;
    vi.stubEnv('REDIS_EVENT_STREAM_PREFIX', prefix);
    const queue = new (EventEmailRetryQueue as any)({ checkIntervalMs: 1_000_000 });
    send.mockReset().mockResolvedValue(undefined);
    try {
      await queue.initialize(async () => redis);
      await test(queue, `${prefix}event-email-retry:`);
    } finally {
      await queue.shutdown();
      const keys = await redis.keys(`${prefix}*`);
      if (keys.length) await redis.del(keys);
      vi.unstubAllEnvs();
    }
  }

  it('atomically claims once and recovers a worker interrupted before delivery without losing the payload', async () => {
    await withQueue(async (queue, prefix) => {
      const params = { tenantId: randomUUID(), to: 'controlled@example.test', template: 'ticket-comment-added', context: {} };
      await queue.enqueue(params);
      const [id] = await redis.zRange(`${prefix}queue`, 0, -1);
      const claims = await Promise.all([queue.claimForProcessing(id), queue.claimForProcessing(id)]);
      expect(claims.sort()).toEqual([0, 1]);
      expect(await redis.get(`${prefix}data:${id}`)).toBeTruthy();
      // Simulate the previous worker dying with its lease expired.
      await redis.zAdd(`${prefix}processing`, { score: Date.now() - 1, value: id });
      await queue.processReady();
      await queue.processReady();
      expect(send).toHaveBeenCalledExactlyOnceWith(params);
      expect(await redis.get(`${prefix}data:${id}`)).toBeNull();
      expect(await redis.zCard(`${prefix}processing`)).toBe(0);
    });
  });

  it('archives ambiguous outcomes and missing payloads instead of reporting success or looping forever', async () => {
    await withQueue(async (queue, prefix) => {
      await queue.enqueue({ tenantId: randomUUID(), to: 'controlled@example.test', template: 'ticket-comment-added', context: {} });
      const [id] = await redis.zRange(`${prefix}queue`, 0, -1);
      await redis.zAdd(`${prefix}queue`, { score: 0, value: id });
      send.mockRejectedValue(new Error('Provider acceptance is unknown'));
      await queue.processReady();
      await queue.processReady();
      expect(send).toHaveBeenCalledOnce();
      expect(JSON.parse((await redis.get(`${prefix}reconciliation:${id}`))!).error).toContain('unknown');
      await redis.zAdd(`${prefix}queue`, { score: 0, value: 'expired-payload' });
      await queue.processReady();
      expect(await redis.get(`${prefix}reconciliation:expired-payload`)).toContain('expired or missing');
      expect(await redis.zCard(`${prefix}processing`)).toBe(0);
    });
  });
});
