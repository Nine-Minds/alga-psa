import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T103/T104: Entra API access follows the tenant tier while Teams remains
 * add-on-only.
 */

const hoisted = vi.hoisted(() => {
  class AddOnAccessError extends Error {
    constructor(addOn: string) {
      super(`This feature requires the ${addOn} add-on.`);
      this.name = 'AddOnAccessError';
    }
  }
  class TierAccessError extends Error {
    constructor(feature: string) {
      super(`This feature requires a higher tier: ${feature}.`);
      this.name = 'TierAccessError';
    }
  }
  return {
    AddOnAccessError,
    TierAccessError,
    getCurrentUserMock: vi.fn(),
    hasPermissionMock: vi.fn(async () => true),
    assertAddOnAccessMock: vi.fn(async () => undefined),
    assertTierAccessMock: vi.fn(async (_feature: string) => undefined),
    isEnabledMock: vi.fn(async () => true),
  };
});

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: hoisted.getCurrentUserMock,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hoisted.hasPermissionMock,
}));

vi.mock('server/src/lib/feature-flags/featureFlags', () => ({
  featureFlags: { isEnabled: hoisted.isEnabledMock },
}));

vi.mock('server/src/lib/tier-gating/assertAddOnAccess', () => ({
  AddOnAccessError: hoisted.AddOnAccessError,
  assertAddOnAccess: hoisted.assertAddOnAccessMock,
}));

vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({
  TierAccessError: hoisted.TierAccessError,
  assertTierAccess: hoisted.assertTierAccessMock,
}));

import { requireEntraUiFlagEnabled } from '@ee/app/api/integrations/entra/_guards';
import { TIER_FEATURES, TIER_FEATURE_MAP, tierHasFeature } from '@alga-psa/types';

describe('Entra tier guard (T103)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.getCurrentUserMock.mockResolvedValue({
      user_id: 'user-1',
      tenant: 'tenant-1',
      user_type: 'internal',
    });
    hoisted.hasPermissionMock.mockResolvedValue(true);
    hoisted.assertAddOnAccessMock.mockResolvedValue(undefined);
    hoisted.assertTierAccessMock.mockResolvedValue(undefined);
    hoisted.isEnabledMock.mockResolvedValue(true);
  });

  it('T103: returns 403 when the tenant tier does not include Entra Sync', async () => {
    hoisted.assertTierAccessMock.mockImplementation(async (feature: TIER_FEATURES) => {
      if (feature === TIER_FEATURES.ENTRA_SYNC) {
        throw new hoisted.TierAccessError(feature);
      }
    });

    const result = await requireEntraUiFlagEnabled('read');

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    await expect((result as Response).json()).resolves.toMatchObject({
      success: false,
      error: 'Microsoft Entra integration is not available for this workspace.',
    });
  });

  it('T103: passes for a Pro tenant with no add-ons and returns tenant/user context', async () => {
    const result = await requireEntraUiFlagEnabled('read');

    expect(result).toEqual({ tenantId: 'tenant-1', userId: 'user-1' });
    expect(hoisted.assertTierAccessMock).toHaveBeenNthCalledWith(1, TIER_FEATURES.INTEGRATIONS);
    expect(hoisted.assertTierAccessMock).toHaveBeenNthCalledWith(2, TIER_FEATURES.ENTRA_SYNC);
    expect(hoisted.assertAddOnAccessMock).not.toHaveBeenCalled();
  });

  it('rethrows unexpected assertion failures instead of masking them as 403', async () => {
    hoisted.assertTierAccessMock.mockRejectedValue(new Error('database down'));

    await expect(requireEntraUiFlagEnabled('read')).rejects.toThrow('database down');
  });
});

describe('tier-vs-addon separation (T104)', () => {
  it('T104: premium tier unlocks Entra Sync while Teams stays add-on-only', () => {
    expect(tierHasFeature('premium', TIER_FEATURES.TEAMS_INTEGRATION)).toBe(false);
    expect(tierHasFeature('premium', TIER_FEATURES.ENTRA_SYNC)).toBe(true);

    for (const tier of Object.keys(TIER_FEATURE_MAP) as Array<keyof typeof TIER_FEATURE_MAP>) {
      expect(TIER_FEATURE_MAP[tier]).not.toContain(TIER_FEATURES.TEAMS_INTEGRATION);
    }

    expect(TIER_FEATURE_MAP.pro).toContain(TIER_FEATURES.ENTRA_SYNC);
    expect(TIER_FEATURE_MAP.premium).toContain(TIER_FEATURES.ENTRA_SYNC);
  });

  it('T104: non-add-on features remain tier-unlocked (control)', () => {
    expect(tierHasFeature('premium', TIER_FEATURES.INTEGRATIONS)).toBe(true);
  });
});
