import { beforeEach, describe, expect, it, vi } from 'vitest';

const isFeatureFlagEnabledMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/core/features', () => ({
  RELEASE_V1_5_FEATURE_FLAG: 'release-v1-5-feature',
  isFeatureFlagEnabled: (...args: unknown[]) => isFeatureFlagEnabledMock(...args),
}));

import {
  assertTeamsFeatureAccess,
  tenantHasTeamsFeatureAccess,
  TeamsFeatureDisabledError,
} from '@alga-psa/ee-microsoft-teams/lib/teams/teamsFeatureGate';

describe('Teams feature gate', () => {
  beforeEach(() => {
    isFeatureFlagEnabledMock.mockReset();
  });

  it('evaluates release-v1-5-feature for the tenant and optional user', async () => {
    isFeatureFlagEnabledMock.mockResolvedValue(true);

    await expect(tenantHasTeamsFeatureAccess('tenant-1', 'user-1')).resolves.toBe(true);
    expect(isFeatureFlagEnabledMock).toHaveBeenCalledWith('release-v1-5-feature', {
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
  });

  it('throws a typed error when the feature is disabled', async () => {
    isFeatureFlagEnabledMock.mockResolvedValue(false);

    await expect(assertTeamsFeatureAccess('tenant-1')).rejects.toBeInstanceOf(
      TeamsFeatureDisabledError,
    );
  });
});
