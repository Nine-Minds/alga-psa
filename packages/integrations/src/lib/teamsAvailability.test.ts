import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TEAMS_INTEGRATION_UI_FLAG,
  getTeamsAvailability,
  resolveTeamsAvailability,
} from './teamsAvailability';

describe('teamsAvailability', () => {
  it('T021/T023/T025/T027/T028/T039/T040/T049/T051/T052/T053/T054: enables Teams for EE tenants with tenant context (server-side no longer consults a feature flag)', async () => {
    const availability = await getTeamsAvailability({
      isEnterpriseEdition: true,
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    expect(availability).toEqual({
      enabled: true,
      reason: 'enabled',
      flagKey: TEAMS_INTEGRATION_UI_FLAG,
    });
  });

  it('T035/T036/T041/T042/T049: resolves CE as unavailable', async () => {
    const availability = await getTeamsAvailability({
      isEnterpriseEdition: false,
      tenantId: 'tenant-1',
    });

    expect(availability).toEqual({
      enabled: false,
      reason: 'ce_unavailable',
      flagKey: TEAMS_INTEGRATION_UI_FLAG,
      message: 'Microsoft Teams integration is only available in Enterprise Edition.',
    });
  });

  it('T022/T041/T042/T049: keeps tenant-not-configured distinct from other disabled results for server-side runtime checks', () => {
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

  it('T024/T049: requires tenant context for server-side availability checks', async () => {
    const availability = await getTeamsAvailability({
      isEnterpriseEdition: true,
    });

    expect(availability).toEqual({
      enabled: false,
      reason: 'tenant_not_configured',
      flagKey: TEAMS_INTEGRATION_UI_FLAG,
      message: 'Microsoft Teams integration requires tenant context.',
    });
  });

  it('T026/T049: ignores blank user IDs and returns enabled for EE tenant contexts', async () => {
    const availability = await getTeamsAvailability({
      isEnterpriseEdition: true,
      tenantId: 'tenant-1',
      userId: '   ',
    });

    expect(availability).toEqual({
      enabled: true,
      reason: 'enabled',
      flagKey: TEAMS_INTEGRATION_UI_FLAG,
    });
  });

  it('T037/T038/T041/T043/T047/T049: client-side resolveTeamsAvailability still emits flag_disabled when UI wrappers pass flagEnabled=false', () => {
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

  it('T050: keeps the shared Teams availability helpers outside use-server modules so UI and action code can import the same file safely', () => {
    const moduleSource = fs.readFileSync(path.resolve(__dirname, 'teamsAvailability.ts'), 'utf8');

    expect(moduleSource).not.toMatch(/['"]use server['"]/);
    expect(moduleSource).toContain('export function resolveTeamsAvailability');
    expect(moduleSource).toContain('export async function getTeamsAvailability');
  });
});
