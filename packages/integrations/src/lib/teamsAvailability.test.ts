import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const isFeatureFlagEnabledMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/core/features', () => ({
  RELEASE_V1_5_FEATURE_FLAG: 'release-v1-5-feature',
  isFeatureFlagEnabled: (...args: unknown[]) => isFeatureFlagEnabledMock(...args),
}));

import { getTeamsAvailability, resolveTeamsAvailability } from './teamsAvailability';

describe('teamsAvailability', () => {
  beforeEach(() => {
    isFeatureFlagEnabledMock.mockReset();
  });

  it('enables Teams for an EE tenant with release-v1-5-feature enabled', async () => {
    isFeatureFlagEnabledMock.mockResolvedValue(true);

    await expect(getTeamsAvailability({
      isEnterpriseEdition: true,
      tenantId: 'tenant-1',
      userId: 'user-1',
    })).resolves.toEqual({ enabled: true, reason: 'enabled' });
    expect(isFeatureFlagEnabledMock).toHaveBeenCalledWith('release-v1-5-feature', {
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
  });

  it('rejects an EE tenant when release-v1-5-feature is disabled', async () => {
    isFeatureFlagEnabledMock.mockResolvedValue(false);

    await expect(getTeamsAvailability({ isEnterpriseEdition: true, tenantId: 'tenant-1' })).resolves.toEqual({
      enabled: false,
      reason: 'feature_disabled',
      message: 'Microsoft Teams integration is not enabled for this tenant.',
    });
  });

  it('resolves CE as unavailable before checking the feature flag', async () => {
    await expect(getTeamsAvailability({ isEnterpriseEdition: false, tenantId: 'tenant-1' })).resolves.toEqual({
      enabled: false,
      reason: 'ce_unavailable',
      message: 'Microsoft Teams integration is only available in Enterprise Edition.',
    });
    expect(isFeatureFlagEnabledMock).not.toHaveBeenCalled();
  });

  it('keeps tenant-not-configured distinct from other disabled results', () => {
    expect(resolveTeamsAvailability({ isEnterpriseEdition: true })).toEqual({
      enabled: false,
      reason: 'tenant_not_configured',
      message: 'Microsoft Teams integration requires tenant context.',
    });
  });

  it('allows EE-only client checks without tenant context when it is not required', async () => {
    await expect(getTeamsAvailability({
      isEnterpriseEdition: true,
      requireTenantContext: false,
    })).resolves.toEqual({ enabled: true, reason: 'enabled' });
    expect(isFeatureFlagEnabledMock).not.toHaveBeenCalled();
  });

  it('keeps client-safe helpers free of server-only feature checks', () => {
    const clientSafeSource = fs.readFileSync(path.resolve(__dirname, 'teamsAvailabilityCore.ts'), 'utf8');
    const serverSource = fs.readFileSync(path.resolve(__dirname, 'teamsAvailability.ts'), 'utf8');

    expect(clientSafeSource).not.toContain('isFeatureFlagEnabled');
    expect(clientSafeSource).toContain('export function resolveTeamsAvailability');
    expect(serverSource).toContain('export async function getTeamsAvailability');
  });
});
