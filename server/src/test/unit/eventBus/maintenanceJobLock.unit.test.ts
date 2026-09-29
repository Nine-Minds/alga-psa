import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/config/redisConfig', () => ({
  getRedisClient: vi.fn(async () => {
    throw new Error('redis down');
  }),
}));

import { acquireMaintenanceJobLock, type MaintenanceLockClient } from '../../../lib/eventBus/subscribers/maintenanceJobLock';

function fakeRedis() {
  const store = new Map<string, string>();
  const client: MaintenanceLockClient = {
    set: async (key, value, options) => {
      expect(options).toEqual({ NX: true, PX: expect.any(Number) });
      if (store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    eval: async (_script, { keys, arguments: args }) => {
      if (store.get(keys[0]) === args[0]) {
        store.delete(keys[0]);
        return 1;
      }
      return 0;
    },
  };
  return { client, store };
}

describe('acquireMaintenanceJobLock', () => {
  it('lets one run hold the job and refuses a second until release', async () => {
    const { client, store } = fakeRedis();
    const first = await acquireMaintenanceJobLock('sweep-teams-online-meetings', { client });
    expect(first).not.toBeNull();
    expect(store.size).toBe(1);

    expect(await acquireMaintenanceJobLock('sweep-teams-online-meetings', { client })).toBeNull();
    // A different job is independent.
    expect(await acquireMaintenanceJobLock('auto-close-tickets', { client })).not.toBeNull();

    await first!.release();
    expect(await acquireMaintenanceJobLock('sweep-teams-online-meetings', { client })).not.toBeNull();
  });

  it('only the owner can release: a stale release never drops a newer holder', async () => {
    const { client, store } = fakeRedis();
    const first = (await acquireMaintenanceJobLock('auto-close-tickets', { client, ttlMs: 1 }))!;
    // Simulate TTL expiry followed by a new holder.
    store.clear();
    const second = await acquireMaintenanceJobLock('auto-close-tickets', { client });
    expect(second).not.toBeNull();

    await first.release();
    expect(store.size).toBe(1);
    await second!.release();
    expect(store.size).toBe(0);
  });

  it('fails open when Redis is unavailable', async () => {
    const lock = await acquireMaintenanceJobLock('auto-close-tickets');
    expect(lock).not.toBeNull();
    await expect(lock!.release()).resolves.toBeUndefined();
  });
});
