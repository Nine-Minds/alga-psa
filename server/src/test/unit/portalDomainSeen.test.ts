import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake Redis client capturing setEx/get/del and tracking quit().
const store = new Map<string, string>();
const fakeClient = {
  setEx: vi.fn(async (key: string, _ttl: number, value: string) => { store.set(key, value); }),
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  del: vi.fn(async (key: string) => { store.delete(key); }),
  quit: vi.fn(async () => undefined),
};
const getRedisClient = vi.hoisted(() => vi.fn());
vi.mock('@/config/redisConfig', () => ({ getRedisClient }));

import {
  recordPortalDomainSeen,
  getPortalDomainLastSeen,
  clearPortalDomainSeen,
} from '@/lib/portal-domains/portalDomainSeen';

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  getRedisClient.mockResolvedValue(fakeClient);
});

describe('portalDomainSeen', () => {
  it('records a timestamp (normalized hostname) and reads it back', async () => {
    await recordPortalDomainSeen('Portal.Acme.com');
    expect(fakeClient.setEx).toHaveBeenCalledTimes(1);
    const lastSeen = await getPortalDomainLastSeen('portal.acme.com');
    expect(typeof lastSeen).toBe('number');
    expect(fakeClient.quit).toHaveBeenCalled();
  });

  it('returns null when a host has never been seen', async () => {
    expect(await getPortalDomainLastSeen('never.seen.com')).toBeNull();
  });

  it('clearPortalDomainSeen removes the marker', async () => {
    await recordPortalDomainSeen('portal.acme.com');
    await clearPortalDomainSeen('portal.acme.com');
    expect(await getPortalDomainLastSeen('portal.acme.com')).toBeNull();
  });

  it('ignores empty/missing hostnames without touching Redis', async () => {
    await recordPortalDomainSeen('');
    await recordPortalDomainSeen(null);
    expect(getRedisClient).not.toHaveBeenCalled();
  });

  it('never throws when Redis is unavailable (best-effort)', async () => {
    getRedisClient.mockRejectedValueOnce(new Error('redis down'));
    await expect(recordPortalDomainSeen('portal.acme.com')).resolves.toBeUndefined();
    getRedisClient.mockRejectedValueOnce(new Error('redis down'));
    await expect(getPortalDomainLastSeen('portal.acme.com')).resolves.toBeNull();
  });
});
