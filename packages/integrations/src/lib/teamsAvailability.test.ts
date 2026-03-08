import { describe, expect, it, vi } from 'vitest';
import {
  TEAMS_INTEGRATION_UI_FLAG,
  getTeamsAvailability,
  resolveTeamsAvailability,
} from './teamsAvailability';

describe('teamsAvailability', () => {
  it('T021/T023/T025/T039/T041/T049/T057: enables Teams only for EE tenants with the tenant flag enabled and forwards tenant/user context to flag evaluation', async () => {
    const evaluateFlag = vi.fn(async () => true);

    const availability = await getTeamsAvailability({
      evaluateFlag,
      isEnterpriseEdition: true,
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    expect(availability).toEqual({
      enabled: true,
      reason: 'enabled',
      flagKey: TEAMS_INTEGRATION_UI_FLAG,
    });
    expect(evaluateFlag).toHaveBeenCalledWith(TEAMS_INTEGRATION_UI_FLAG, {
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
  });

  it('T035/T041/T049: resolves CE as unavailable without attempting feature-flag evaluation', async () => {
    const evaluateFlag = vi.fn(async () => true);

    const availability = await getTeamsAvailability({
      evaluateFlag,
      isEnterpriseEdition: false,
      tenantId: 'tenant-1',
    });

    expect(availability).toEqual({
      enabled: false,
      reason: 'ce_unavailable',
      flagKey: TEAMS_INTEGRATION_UI_FLAG,
      message: 'Microsoft Teams integration is only available in Enterprise Edition.',
    });
    expect(evaluateFlag).not.toHaveBeenCalled();
  });

  it('T022/T041/T049: keeps tenant-not-configured distinct from flag-disabled results for server-side runtime checks', () => {
    expect(
      resolveTeamsAvailability({
        isEnterpriseEdition: true,
        flagEnabled: true,
      })
    ).toEqual({
      enabled: false,
      reason: 'tenant_not_configured',
      flagKey: TEAMS_INTEGRATION_UI_FLAG,
      message: 'Microsoft Teams integration requires tenant context.',
    });
  });

  it('T024/T049: requires tenant context before evaluating the Teams flag for server-side runtime checks', async () => {
    const evaluateFlag = vi.fn(async () => true);

    const availability = await getTeamsAvailability({
      evaluateFlag,
      isEnterpriseEdition: true,
    });

    expect(availability).toEqual({
      enabled: false,
      reason: 'tenant_not_configured',
      flagKey: TEAMS_INTEGRATION_UI_FLAG,
      message: 'Microsoft Teams integration requires tenant context.',
    });
    expect(evaluateFlag).not.toHaveBeenCalled();
  });

  it('T037/T041/T043/T047/T049: resolves EE with the UI flag off as disabled and supports UI wrappers that do not require tenant context', () => {
    expect(
      resolveTeamsAvailability({
        isEnterpriseEdition: true,
        flagEnabled: false,
        requireTenantContext: false,
      })
    ).toEqual({
      enabled: false,
      reason: 'flag_disabled',
      flagKey: TEAMS_INTEGRATION_UI_FLAG,
      message: 'Microsoft Teams integration is disabled for this tenant.',
    });
  });

  it('T057/T058: defaults to disabled when feature-flag evaluation throws', async () => {
    const evaluateFlag = vi.fn(async () => {
      throw new Error('posthog unavailable');
    });

    const availability = await getTeamsAvailability({
      evaluateFlag,
      isEnterpriseEdition: true,
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    expect(availability).toEqual({
      enabled: false,
      reason: 'flag_disabled',
      flagKey: TEAMS_INTEGRATION_UI_FLAG,
      message: 'Microsoft Teams integration is disabled for this tenant.',
    });
  });
});
