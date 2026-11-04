import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';

vi.unmock('redis');
const send = vi.hoisted(() => vi.fn());
vi.mock('@/lib/notifications/sendEventEmail', () => ({ sendEventEmail: send }));
import { EventEmailRetryQueue } from '@/lib/notifications/EventEmailRetryQueue';

// Required integration coverage. Use the lane's Redis service; every test owns
// and removes a random key prefix rather than clearing shared service state.
describe('event email retry processing leases (Redis)', () => {
  let redis: ReturnType<typeof createClient>;
  beforeAll(async () => {
    if (process.env.REAL_REDIS !== '1' || (!process.env.TEST_REDIS_URL && !process.env.REDIS_HOST)) {
      throw new Error('Retry recovery tests require REAL_REDIS=1 and TEST_REDIS_URL or REDIS_HOST/REDIS_PORT');
    }
    redis = createClient({
      ...(process.env.TEST_REDIS_URL
        ? { url: process.env.TEST_REDIS_URL }
        : { socket: { host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT || 6379) } }),
      password: process.env.REDIS_PASSWORD,
    });
    await redis.connect();
  });
  afterAll(async () => { if (redis?.isOpen) await redis.quit(); });

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
      const params = { tenantId: randomUUID(), to: 'controlled@example.test', template: 'ticket-comment-added', context: {}, mailClass: 'ticket' as const, boardId: randomUUID(), senderId: randomUUID() };
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

  it('keeps card retries separate from the default worktree retry queue', async () => {
    const defaultPrefix = 'alga-psa:event-email-retry:';
    const cardStreamPrefix = `event-stream:security-2-findings-in-deliveryprovider-ts:${randomUUID()}:`;
    const cardPrefix = `${cardStreamPrefix}event-email-retry:`;
    const params = (to: string) => ({ tenantId: randomUUID(), to, template: 'ticket-comment-added', context: {}, mailClass: 'ticket' as const });
    vi.stubEnv('REDIS_EVENT_STREAM_PREFIX', 'alga-psa:');
    const defaultQueue = new (EventEmailRetryQueue as any)({ checkIntervalMs: 1_000_000 });
    vi.stubEnv('REDIS_EVENT_STREAM_PREFIX', cardStreamPrefix);
    const cardQueue = new (EventEmailRetryQueue as any)({ checkIntervalMs: 1_000_000 });
    const defaultRecipient = 'default-card-isolation@example.test';
    const cardRecipient = 'card-card-isolation@example.test';
    const defaultIdsBefore = new Set(await redis.zRange(`${defaultPrefix}queue`, 0, -1));
    try {
      await defaultQueue.initialize(async () => redis);
      await cardQueue.initialize(async () => redis);
      await defaultQueue.enqueue(params(defaultRecipient));
      await cardQueue.enqueue(params(cardRecipient));

      let defaultId: string | undefined;
      for (const id of await redis.zRange(`${defaultPrefix}queue`, 0, -1)) {
        if (!defaultIdsBefore.has(id) && (await redis.get(`${defaultPrefix}data:${id}`))?.includes(defaultRecipient)) {
          defaultId = id;
          break;
        }
      }
      const [cardId] = await redis.zRange(`${cardPrefix}queue`, 0, -1);
      expect(defaultId).toBeTruthy();
      expect(cardId).toBeTruthy();
      expect(await redis.get(`${defaultPrefix}data:${defaultId}`)).toContain(defaultRecipient);
      expect(await redis.get(`${cardPrefix}data:${cardId}`)).toContain(cardRecipient);
      expect(await redis.zRange(`${defaultPrefix}queue`, 0, -1)).not.toContain(cardId);
      expect(await redis.zRange(`${cardPrefix}queue`, 0, -1)).not.toContain(defaultId);
    } finally {
      await cardQueue.shutdown();
      await defaultQueue.shutdown();
      for (const [prefix, recipients] of [[defaultPrefix, [defaultRecipient]], [cardPrefix, [cardRecipient]]] as const) {
        const ids = await redis.zRange(`${prefix}queue`, 0, -1);
        for (const id of ids) {
          const dataKey = `${prefix}data:${id}`;
          const data = await redis.get(dataKey);
          if (recipients.some(recipient => data?.includes(recipient))) {
            await redis.zRem(`${prefix}queue`, id);
            await redis.del(dataKey);
          }
        }
      }
      vi.unstubAllEnvs();
    }
  });
});
