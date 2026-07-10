import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T103/T104 (closing the 2026-05-12 teams-enterprise-addons plan debt):
 * Entra API guard returns 403 without the enterprise add-on, and tier alone
 * (premium, no add-on) never unlocks the add-on-only Teams/Entra features.
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
    assertTierAccessMock: vi.fn(async () => undefined),
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

describe('Entra add-on guard (T103)', () => {
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

  it('T103: returns 403 when the enterprise add-on is missing — even for a tenant whose tier passes', async () => {
    // Tier assertion passes (premium tier), add-on assertion fails: the guard
    // must still refuse — tier alone never unlocks add-on-only features.
    hoisted.assertAddOnAccessMock.mockRejectedValue(new hoisted.AddOnAccessError('Enterprise'));

    const result = await requireEntraUiFlagEnabled('read');

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    await expect((result as Response).json()).resolves.toMatchObject({
      success: false,
      error: 'Microsoft Entra integration is not available for this workspace.',
    });
  });

  it('T103: passes with the enterprise add-on active and returns tenant/user context', async () => {
    const result = await requireEntraUiFlagEnabled('read');

    expect(result).toEqual({ tenantId: 'tenant-1', userId: 'user-1' });
    expect(hoisted.assertAddOnAccessMock).toHaveBeenCalled();
  });

  it('rethrows unexpected assertion failures instead of masking them as 403', async () => {
    hoisted.assertAddOnAccessMock.mockRejectedValue(new Error('database down'));

    await expect(requireEntraUiFlagEnabled('read')).rejects.toThrow('database down');
  });
});

describe('tier-vs-addon separation (T104)', () => {
  it('T104: premium tier alone does not unlock Teams or Entra features', () => {
    expect(tierHasFeature('premium', TIER_FEATURES.TEAMS_INTEGRATION)).toBe(false);
    expect(tierHasFeature('premium', TIER_FEATURES.ENTRA_SYNC)).toBe(false);

    for (const tier of Object.keys(TIER_FEATURE_MAP) as Array<keyof typeof TIER_FEATURE_MAP>) {
      expect(TIER_FEATURE_MAP[tier]).not.toContain(TIER_FEATURES.TEAMS_INTEGRATION);
      expect(TIER_FEATURE_MAP[tier]).not.toContain(TIER_FEATURES.ENTRA_SYNC);
    }
  });

  it('T104: non-add-on features remain tier-unlocked (control)', () => {
    expect(tierHasFeature('premium', TIER_FEATURES.INTEGRATIONS)).toBe(true);
  });
});
