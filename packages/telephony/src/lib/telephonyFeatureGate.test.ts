import { beforeEach, describe, expect, it, vi } from 'vitest';

const isFeatureFlagEnabledMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/core/features', () => ({
  RELEASE_V1_5_FEATURE_FLAG: 'release-v1-5-feature',
  isFeatureFlagEnabled: (...args: unknown[]) => isFeatureFlagEnabledMock(...args),
}));

import {
  assertTelephonyFeatureAccess,
  tenantHasTelephonyFeatureAccess,
  TelephonyFeatureDisabledError,
} from './telephonyFeatureGate';

describe('telephony feature gate', () => {
  beforeEach(() => {
    isFeatureFlagEnabledMock.mockReset();
  });

  it('denies access when release-v1-5-feature is disabled', async () => {
    isFeatureFlagEnabledMock.mockResolvedValue(false);

    await expect(tenantHasTelephonyFeatureAccess('t1')).resolves.toBe(false);
    expect(isFeatureFlagEnabledMock).toHaveBeenCalledWith('release-v1-5-feature', {
      tenantId: 't1',
    });
  });

  it('allows access when release-v1-5-feature is enabled', async () => {
    isFeatureFlagEnabledMock.mockResolvedValue(true);

    await expect(tenantHasTelephonyFeatureAccess('t1')).resolves.toBe(true);
    await expect(assertTelephonyFeatureAccess('t1')).resolves.toBeUndefined();
  });

  it('throws a typed error when the feature is disabled', async () => {
    isFeatureFlagEnabledMock.mockResolvedValue(false);

    await expect(assertTelephonyFeatureAccess('t1')).rejects.toBeInstanceOf(
      TelephonyFeatureDisabledError,
    );
  });
});
