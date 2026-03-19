import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  TEAMS_INTEGRATION_UI_FLAG,
  getTeamsAvailability,
  resolveTeamsAvailability,
} from './teamsAvailability';

describe('teamsAvailability', () => {
  it('T021/T023/T025/T027/T028/T039/T040/T041/T049/T051/T052/T053/T054/T057/T397/T398: enables Teams only for EE tenants with the tenant flag enabled and forwards tenant/user context to flag evaluation', async () => {
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

  it('T035/T036/T041/T042/T049/T397/T398: resolves CE as unavailable without attempting feature-flag evaluation', async () => {
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

  it('T022/T041/T042/T049/T397/T398: keeps tenant-not-configured distinct from flag-disabled results for server-side runtime checks', () => {
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

  it('T024/T049/T397/T398: requires tenant context before evaluating the Teams flag for server-side runtime checks', async () => {
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

  it('T026/T049/T397/T398: treats user context as optional and omits blank user IDs from tenant-scoped flag evaluation', async () => {
    const evaluateFlag = vi.fn(async () => true);

    const availability = await getTeamsAvailability({
      evaluateFlag,
      isEnterpriseEdition: true,
      tenantId: 'tenant-1',
      userId: '   ',
    });

    expect(availability).toEqual({
      enabled: true,
      reason: 'enabled',
      flagKey: TEAMS_INTEGRATION_UI_FLAG,
    });
    expect(evaluateFlag).toHaveBeenCalledWith(TEAMS_INTEGRATION_UI_FLAG, {
      tenantId: 'tenant-1',
      userId: undefined,
    });
  });

  it('T037/T038/T041/T043/T047/T049/T397/T398: resolves EE with the UI flag off as disabled and supports UI wrappers that do not require tenant context', () => {
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

  it('T050: keeps the shared Teams availability helpers outside use-server modules so UI and action code can import the same file safely', () => {
    const moduleSource = fs.readFileSync(path.resolve(__dirname, 'teamsAvailability.ts'), 'utf8');

    expect(moduleSource).not.toMatch(/['"]use server['"]/);
    expect(moduleSource).toContain('export function resolveTeamsAvailability');
    expect(moduleSource).toContain('export async function getTeamsAvailability');
  });
});
