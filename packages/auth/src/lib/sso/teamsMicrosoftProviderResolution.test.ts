import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  type TeamsIntegrationRow = {
    tenant: string;
    selected_profile_id: string | null;
    install_status: 'not_configured' | 'install_pending' | 'active' | 'error';
  };

  type MicrosoftProfileRow = {
    tenant: string;
    profile_id: string;
    client_id: string;
    tenant_id: string;
    client_secret_ref: string;
    is_archived: boolean;
  };

  const state = {
    teamsIntegrations: [] as TeamsIntegrationRow[],
    microsoftProfiles: [] as MicrosoftProfileRow[],
    tenantSecrets: new Map<string, string>(),
  };

  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
  const matchesWhere = (row: Record<string, unknown>, conditions: Record<string, unknown>): boolean =>
    Object.entries(conditions).every(([key, value]) => row[key] === value);

  const createQuery = (table: string) => {
    const filters: Record<string, unknown>[] = [];
    const getRows = () => {
      if (table === 'teams_integrations') return state.teamsIntegrations;
      if (table === 'microsoft_profiles') return state.microsoftProfiles;
      return [] as Array<Record<string, unknown>>;
    };

    const filteredRows = () => getRows().filter((row) => filters.every((filter) => matchesWhere(row, filter)));

    return {
      where(conditions: Record<string, unknown>) {
        filters.push(conditions);
        return this;
      },
      async first() {
        const row = filteredRows()[0];
        return row ? clone(row) : undefined;
      },
    };
  };

  const dbMock: any = ((table: string) => createQuery(table)) as any;

  return {
    state,
    getTenantSecretMock: vi.fn(async (tenant: string, key: string) => state.tenantSecrets.get(`${tenant}:${key}`) || null),
    getAdminConnectionMock: vi.fn(async () => dbMock),
  };
});

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    warn: vi.fn(),
  },
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: hoisted.getTenantSecretMock,
  }),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: hoisted.getAdminConnectionMock,
}));

import { resolveTeamsMicrosoftProviderConfig } from './teamsMicrosoftProviderResolution';

describe('resolveTeamsMicrosoftProviderConfig', () => {
  beforeEach(() => {
    hoisted.state.teamsIntegrations.length = 0;
    hoisted.state.microsoftProfiles.length = 0;
    hoisted.state.tenantSecrets.clear();
    delete process.env.AZURE_AD_CLIENT_ID;
    delete process.env.AZURE_AD_CLIENT_SECRET;
    delete process.env.AZURE_AD_TENANT_ID;
    delete process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_SECRET;
    delete process.env.MICROSOFT_TENANT_ID;
  });

  it('T149: resolves Microsoft credentials from the Teams-selected tenant profile instead of any unrelated global fallback path', async () => {
    hoisted.state.teamsIntegrations.push({
      tenant: 'tenant-1',
      selected_profile_id: 'profile-2',
      install_status: 'active',
    });
    hoisted.state.microsoftProfiles.push(
      {
        tenant: 'tenant-1',
        profile_id: 'profile-1',
        client_id: 'wrong-client',
        tenant_id: 'wrong-tenant',
        client_secret_ref: 'wrong-secret-ref',
        is_archived: false,
      },
      {
        tenant: 'tenant-1',
        profile_id: 'profile-2',
        client_id: 'teams-client-id',
        tenant_id: 'teams-tenant-guid',
        client_secret_ref: 'teams-secret-ref',
        is_archived: false,
      },
    );
    hoisted.state.tenantSecrets.set('tenant-1:teams-secret-ref', 'teams-secret');
    hoisted.state.tenantSecrets.set('tenant-1:wrong-secret-ref', 'wrong-secret');

    const result = await resolveTeamsMicrosoftProviderConfig('tenant-1');

    expect(result).toEqual({
      status: 'ready',
      tenantId: 'tenant-1',
      profileId: 'profile-2',
      clientId: 'teams-client-id',
      clientSecret: 'teams-secret',
      microsoftTenantId: 'teams-tenant-guid',
    });
  });

  it('T150: returns Teams-safe not-configured and invalid-profile states when the tenant setup or selected profile cannot support auth', async () => {
    await expect(resolveTeamsMicrosoftProviderConfig('tenant-1')).resolves.toEqual({
      status: 'not_configured',
      tenantId: 'tenant-1',
      message: 'Teams is not configured for this tenant',
    });

    hoisted.state.teamsIntegrations.push({
      tenant: 'tenant-1',
      selected_profile_id: 'archived-profile',
      install_status: 'active',
    });
    hoisted.state.microsoftProfiles.push({
      tenant: 'tenant-1',
      profile_id: 'archived-profile',
      client_id: 'archived-client',
      tenant_id: 'archived-tenant',
      client_secret_ref: 'archived-secret-ref',
      is_archived: true,
    });

    await expect(resolveTeamsMicrosoftProviderConfig('tenant-1')).resolves.toEqual({
      status: 'invalid_profile',
      tenantId: 'tenant-1',
      profileId: 'archived-profile',
      message: 'Selected Teams Microsoft profile is missing or archived',
    });
  });

  it('T179: prefers the tenant-selected Teams profile over broad app-level Microsoft environment credentials for Teams auth', async () => {
    process.env.AZURE_AD_CLIENT_ID = 'global-client-id';
    process.env.AZURE_AD_CLIENT_SECRET = 'global-client-secret';
    process.env.AZURE_AD_TENANT_ID = 'global-tenant-id';
    process.env.MICROSOFT_CLIENT_ID = 'global-microsoft-client-id';
    process.env.MICROSOFT_CLIENT_SECRET = 'global-microsoft-client-secret';
    process.env.MICROSOFT_TENANT_ID = 'global-microsoft-tenant-id';

    hoisted.state.teamsIntegrations.push({
      tenant: 'tenant-1',
      selected_profile_id: 'profile-2',
      install_status: 'active',
    });
    hoisted.state.microsoftProfiles.push({
      tenant: 'tenant-1',
      profile_id: 'profile-2',
      client_id: 'teams-client-id',
      tenant_id: 'teams-tenant-guid',
      client_secret_ref: 'teams-secret-ref',
      is_archived: false,
    });
    hoisted.state.tenantSecrets.set('tenant-1:teams-secret-ref', 'teams-secret');

    const result = await resolveTeamsMicrosoftProviderConfig('tenant-1');

    expect(result).toEqual({
      status: 'ready',
      tenantId: 'tenant-1',
      profileId: 'profile-2',
      clientId: 'teams-client-id',
      clientSecret: 'teams-secret',
      microsoftTenantId: 'teams-tenant-guid',
    });
    expect(result.clientId).not.toBe(process.env.AZURE_AD_CLIENT_ID);
    expect(result.clientId).not.toBe(process.env.MICROSOFT_CLIENT_ID);
    expect(result.clientSecret).not.toBe(process.env.AZURE_AD_CLIENT_SECRET);
    expect(result.clientSecret).not.toBe(process.env.MICROSOFT_CLIENT_SECRET);
    expect(result.microsoftTenantId).not.toBe(process.env.AZURE_AD_TENANT_ID);
    expect(result.microsoftTenantId).not.toBe(process.env.MICROSOFT_TENANT_ID);
  });

  it('T180: does not fall back to broad app-level Microsoft environment credentials when the Teams-selected profile is missing or invalid', async () => {
    process.env.AZURE_AD_CLIENT_ID = 'global-client-id';
    process.env.AZURE_AD_CLIENT_SECRET = 'global-client-secret';
    process.env.AZURE_AD_TENANT_ID = 'global-tenant-id';

    await expect(resolveTeamsMicrosoftProviderConfig('tenant-1')).resolves.toEqual({
      status: 'not_configured',
      tenantId: 'tenant-1',
      message: 'Teams is not configured for this tenant',
    });

    hoisted.state.teamsIntegrations.push({
      tenant: 'tenant-1',
      selected_profile_id: 'archived-profile',
      install_status: 'active',
    });
    hoisted.state.microsoftProfiles.push({
      tenant: 'tenant-1',
      profile_id: 'archived-profile',
      client_id: 'archived-client',
      tenant_id: 'archived-tenant',
      client_secret_ref: 'archived-secret-ref',
      is_archived: true,
    });

    await expect(resolveTeamsMicrosoftProviderConfig('tenant-1')).resolves.toEqual({
      status: 'invalid_profile',
      tenantId: 'tenant-1',
      profileId: 'archived-profile',
      message: 'Selected Teams Microsoft profile is missing or archived',
    });
  });
});
