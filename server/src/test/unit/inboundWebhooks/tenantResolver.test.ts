import { beforeEach, describe, expect, it, vi } from 'vitest';

const getTenantIdBySlug = vi.fn();

vi.mock('@alga-psa/db', () => ({
  getTenantIdBySlug: (...args: unknown[]) => getTenantIdBySlug(...args),
}));

import {
  resolveInboundWebhookTenantSlug,
  clearInboundWebhookTenantSlugCacheForTest,
} from '@/lib/inboundWebhooks/tenantResolver';

describe('inbound webhook tenant resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    clearInboundWebhookTenantSlugCacheForTest();
    getTenantIdBySlug.mockResolvedValue('tenant-uuid-1');
  });

  it('should resolve a tenant slug through the db lookup', async () => {
    const tenant = await resolveInboundWebhookTenantSlug('acme');

    expect(tenant).toBe('tenant-uuid-1');
    expect(getTenantIdBySlug).toHaveBeenCalledTimes(1);
    expect(getTenantIdBySlug).toHaveBeenCalledWith('acme');
  });

  it('should serve repeat lookups from the cache without re-querying', async () => {
    await resolveInboundWebhookTenantSlug('acme');
    const second = await resolveInboundWebhookTenantSlug('acme');

    expect(second).toBe('tenant-uuid-1');
    expect(getTenantIdBySlug).toHaveBeenCalledTimes(1);
  });

  it('should cache negative lookups (unknown slugs) as null', async () => {
    getTenantIdBySlug.mockResolvedValue(null);

    expect(await resolveInboundWebhookTenantSlug('ghost')).toBeNull();
    expect(await resolveInboundWebhookTenantSlug('ghost')).toBeNull();
    expect(getTenantIdBySlug).toHaveBeenCalledTimes(1);
  });

  it('should refresh entries after the cache TTL elapses', async () => {
    vi.useFakeTimers();
    try {
      await resolveInboundWebhookTenantSlug('acme');
      expect(getTenantIdBySlug).toHaveBeenCalledTimes(1);

      // Just before TTL: still cached.
      vi.advanceTimersByTime(59_000);
      await resolveInboundWebhookTenantSlug('acme');
      expect(getTenantIdBySlug).toHaveBeenCalledTimes(1);

      // After the 60s TTL: must re-query.
      vi.advanceTimersByTime(2_000);
      getTenantIdBySlug.mockResolvedValue('tenant-uuid-2');
      const refreshed = await resolveInboundWebhookTenantSlug('acme');

      expect(refreshed).toBe('tenant-uuid-2');
      expect(getTenantIdBySlug).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should cache slugs independently of each other', async () => {
    getTenantIdBySlug
      .mockResolvedValueOnce('tenant-a')
      .mockResolvedValueOnce('tenant-b');

    expect(await resolveInboundWebhookTenantSlug('slug-a')).toBe('tenant-a');
    expect(await resolveInboundWebhookTenantSlug('slug-b')).toBe('tenant-b');
    expect(await resolveInboundWebhookTenantSlug('slug-a')).toBe('tenant-a');
    expect(getTenantIdBySlug).toHaveBeenCalledTimes(2);
  });

  it('should evict the oldest entry once the cache reaches its capacity', async () => {
    // Fill the cache to its 1000-entry capacity.
    for (let i = 0; i < 1000; i++) {
      getTenantIdBySlug.mockResolvedValueOnce(`tenant-${i}`);
      await resolveInboundWebhookTenantSlug(`slug-${i}`);
    }
    expect(getTenantIdBySlug).toHaveBeenCalledTimes(1000);

    // Adding one more evicts the oldest entry (slug-0).
    getTenantIdBySlug.mockResolvedValueOnce('tenant-overflow');
    await resolveInboundWebhookTenantSlug('slug-overflow');

    getTenantIdBySlug.mockResolvedValueOnce('tenant-0-refetched');
    const refetched = await resolveInboundWebhookTenantSlug('slug-0');

    expect(refetched).toBe('tenant-0-refetched');
    expect(getTenantIdBySlug).toHaveBeenCalledTimes(1002);

    // A still-cached entry continues to be served without a query.
    await resolveInboundWebhookTenantSlug('slug-999');
    expect(getTenantIdBySlug).toHaveBeenCalledTimes(1002);
  });
});
