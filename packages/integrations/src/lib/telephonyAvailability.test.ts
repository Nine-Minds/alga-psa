import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const isFeatureFlagEnabledMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/core/features', () => ({
  RELEASE_V1_5_FEATURE_FLAG: 'release-v1-5-feature',
  isFeatureFlagEnabled: (...args: unknown[]) => isFeatureFlagEnabledMock(...args),
}));

import {
  getTelephonyAvailability,
  resolveTelephonyAvailability,
  tenantHasTelephonyFeatureAccess,
} from './telephonyAvailability';

describe('telephonyAvailability', () => {
  beforeEach(() => {
    isFeatureFlagEnabledMock.mockReset();
  });

  it('enables telephony for an EE tenant with release-v1-5-feature enabled', async () => {
    isFeatureFlagEnabledMock.mockResolvedValue(true);
    await expect(getTelephonyAvailability({ isEnterpriseEdition: true, tenantId: 'tenant-1' }))
      .resolves.toEqual({ enabled: true, reason: 'enabled' });
  });

  it('returns feature_disabled when release-v1-5-feature is disabled', async () => {
    isFeatureFlagEnabledMock.mockResolvedValue(false);
    await expect(getTelephonyAvailability({ isEnterpriseEdition: true, tenantId: 'tenant-1' }))
      .resolves.toEqual({
        enabled: false,
        reason: 'feature_disabled',
        message: 'Telephony integrations are not enabled for this tenant.',
      });
  });

  it('resolves CE unavailable before checking the feature flag', async () => {
    await expect(getTelephonyAvailability({ isEnterpriseEdition: false, tenantId: 'tenant-1' }))
      .resolves.toEqual({
        enabled: false,
        reason: 'ce_unavailable',
        message: 'Telephony integrations are only available in Enterprise Edition.',
      });
    expect(isFeatureFlagEnabledMock).not.toHaveBeenCalled();
  });

  it('requires tenant context', () => {
    expect(resolveTelephonyAvailability({ isEnterpriseEdition: true })).toEqual({
      enabled: false,
      reason: 'tenant_not_configured',
      message: 'Telephony integrations require tenant context.',
    });
  });

  it('evaluates the release flag with tenant and user context', async () => {
    isFeatureFlagEnabledMock.mockResolvedValue(true);
    await expect(tenantHasTelephonyFeatureAccess('tenant-1', 'user-1')).resolves.toBe(true);
    expect(isFeatureFlagEnabledMock).toHaveBeenCalledWith('release-v1-5-feature', {
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
  });

  it('keeps the client-safe resolver free of server-only feature checks', () => {
    const clientSafeSource = fs.readFileSync(path.resolve(__dirname, 'telephonyAvailabilityCore.ts'), 'utf8');
    const serverSource = fs.readFileSync(path.resolve(__dirname, 'telephonyAvailability.ts'), 'utf8');

    expect(clientSafeSource).not.toContain('isFeatureFlagEnabled');
    expect(clientSafeSource).toContain('export function resolveTelephonyAvailability');
    expect(serverSource).toContain('export async function getTelephonyAvailability');
  });
});
