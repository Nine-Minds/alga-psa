import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const flag = vi.hoisted(() => ({ enabled: vi.fn() }));
vi.mock('@alga-psa/core/features', () => ({ isFeatureFlagEnabled: flag.enabled }));

import { isCoManagedPurchaseSurfaceOpen } from './co-managed-purchase-surface';

beforeEach(() => {
  flag.enabled.mockReset().mockResolvedValue(true);
  process.env.STRIPE_CO_MANAGED_USER_PRICE_ID = 'price_co_managed';
  delete process.env.FORCE_CAPABILITIES;
});
afterEach(() => { delete process.env.STRIPE_CO_MANAGED_USER_PRICE_ID; delete process.env.FORCE_CAPABILITIES; });

describe('co-managed purchase surface', () => {
  it('is open with the price configured and the release flag on', async () => {
    expect(await isCoManagedPurchaseSurfaceOpen('t')).toBe(true);
    expect(flag.enabled).toHaveBeenCalledWith('release-v2-0-feature', { tenantId: 't' });
  });
  it('is closed, without asking the flag service, when the price id is unset', async () => {
    delete process.env.STRIPE_CO_MANAGED_USER_PRICE_ID;
    expect(await isCoManagedPurchaseSurfaceOpen('t')).toBe(false);
    expect(flag.enabled).not.toHaveBeenCalled();
  });
  it.each(['co-managed:off', 'co-managed:bogus'])('is closed under FORCE_CAPABILITIES=%s', async (force) => {
    process.env.FORCE_CAPABILITIES = force;
    expect(await isCoManagedPurchaseSurfaceOpen('t')).toBe(false);
    expect(flag.enabled).not.toHaveBeenCalled();
  });
  it('is closed with the release flag off or unavailable', async () => {
    flag.enabled.mockResolvedValue(false);
    expect(await isCoManagedPurchaseSurfaceOpen('t')).toBe(false);
    flag.enabled.mockRejectedValue(new Error('posthog down'));
    expect(await isCoManagedPurchaseSurfaceOpen('t')).toBe(false);
  });
});
