import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  type MicrosoftProfileRecord = {
    tenant: string;
    profile_id: string;
    display_name: string;
    client_id: string;
    tenant_id: string;
    client_secret_ref: string;
    is_archived: boolean;
  };

  type TeamsIntegrationRecord = {
    tenant: string;
    selected_profile_id: string | null;
    install_status: 'not_configured' | 'install_pending' | 'active' | 'error';
  };

  const state = {
    mockUser: { user_id: 'user-1', user_type: 'internal' } as any,
    mockCtx: { tenant: 'tenant-1' } as any,
    tenantSecrets: new Map<string, string>(),
    appSecrets: new Map<string, string>(),
    microsoftProfiles: [] as MicrosoftProfileRecord[],
    teamsIntegrations: [] as TeamsIntegrationRecord[],
  };

  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
  const matchesWhere = (row: Record<string, unknown>, conditions: Record<string, unknown>): boolean =>
    Object.entries(conditions).every(([key, value]) => row[key] === value);

  const createQuery = (table: string) => {
    const filters: Record<string, unknown>[] = [];

    const getRows = () => {
      if (table === 'microsoft_profiles') {
        return state.microsoftProfiles;
      }
      if (table === 'teams_integrations') {
        return state.teamsIntegrations;
      }
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
      async select(..._args: unknown[]) {
        return filteredRows().map((row) => clone(row));
      },
    };
  };

  const knexMock: any = ((table: string) => createQuery(table)) as any;

  return {
    state,
    hasPermissionMock: vi.fn(async (..._args: unknown[]) => true),
    getTenantSecretMock: vi.fn(async (tenant: string, key: string) => state.tenantSecrets.get(`${tenant}:${key}`) || null),
    getAppSecretMock: vi.fn(async (key: string) => state.appSecrets.get(key) || null),
    knexMock,
  };
});

const { microsoftProfiles, teamsIntegrations, tenantSecrets, appSecrets } = hoisted.state;
const { hasPermissionMock, getTenantSecretMock, getAppSecretMock, knexMock } = hoisted;

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth:
    (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(hoisted.state.mockUser, hoisted.state.mockCtx, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hoisted.hasPermissionMock,
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: hoisted.getTenantSecretMock,
    getAppSecret: hoisted.getAppSecretMock,
  }),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: hoisted.knexMock }),
}));

vi.mock('./providerReadiness', () => ({
  getMicrosoftProfileReadiness: vi.fn(async (tenant: string, config: any) => {
    const secret = tenantSecrets.get(`${tenant}:${config.clientSecretRef}`) || null;
    const ready = Boolean(config.clientId && config.tenantId && secret && !config.isArchived);
    return {
      ready,
      clientIdConfigured: Boolean(config.clientId),
      clientSecretConfigured: Boolean(secret),
      tenantIdConfigured: Boolean(config.tenantId),
      active: !config.isArchived,
    };
  }),
}));

import { getTeamsAppPackageStatus } from './teamsPackageActions';

function addMicrosoftProfile({
  tenant,
  profileId,
  displayName,
  clientId,
  tenantId,
  secretRef,
  archived = false,
}: {
  tenant: string;
  profileId: string;
  displayName: string;
  clientId: string;
  tenantId: string;
  secretRef: string;
  archived?: boolean;
}) {
  microsoftProfiles.push({
    tenant,
    profile_id: profileId,
    display_name: displayName,
    client_id: clientId,
    tenant_id: tenantId,
    client_secret_ref: secretRef,
    is_archived: archived,
  });
}

describe('Teams app package actions', () => {
  beforeEach(() => {
    hoisted.state.mockUser = { user_id: 'user-1', user_type: 'internal' };
    hoisted.state.mockCtx = { tenant: 'tenant-1' };
    microsoftProfiles.length = 0;
    teamsIntegrations.length = 0;
    tenantSecrets.clear();
    appSecrets.clear();
    hasPermissionMock.mockResolvedValue(true);
  });

  it('T117/T119/T121/T123/T125/T127/T129/T131/T133/T135/T137/T141: returns Teams manifest metadata with declared surfaces, app identity, install state, and environment base URL', async () => {
    appSecrets.set('NEXT_PUBLIC_BASE_URL', 'https://tenant.example.com/');
    addMicrosoftProfile({
      tenant: 'tenant-1',
      profileId: 'profile-1',
      displayName: 'Teams Production Profile',
      clientId: 'teams-client-id',
      tenantId: 'teams-tenant-guid',
      secretRef: 'teams-secret-ref',
    });
    tenantSecrets.set('tenant-1:teams-secret-ref', 'super-secret');
    teamsIntegrations.push({
      tenant: 'tenant-1',
      selected_profile_id: 'profile-1',
      install_status: 'install_pending',
    });

    const result = await getTeamsAppPackageStatus();

    expect(result.success).toBe(true);
    expect(result.package).toMatchObject({
      installStatus: 'install_pending',
      selectedProfileId: 'profile-1',
      appId: 'teams-client-id',
      botId: 'teams-client-id',
      manifestVersion: '1.24',
      packageVersion: '1.0.0',
      fileName: 'alga-psa-teams-tenant-1.zip',
      baseUrl: 'https://tenant.example.com',
      validDomains: ['tenant.example.com', 'token.botframework.com'],
      webApplicationInfo: {
        id: 'teams-client-id',
        resource: 'api://tenant.example.com/teams/teams-client-id',
      },
    });

    expect(result.package?.manifest.staticTabs[0]).toMatchObject({
      entityId: 'alga-psa-personal-tab',
      scopes: ['personal'],
      contentUrl: 'https://tenant.example.com/teams/tab',
    });
    expect(result.package?.manifest.bots[0]).toMatchObject({
      botId: 'teams-client-id',
      scopes: ['personal'],
    });
    expect(result.package?.manifest.composeExtensions[0]?.commands.map((command) => command.id)).toEqual([
      'searchRecords',
      'createTicketFromMessage',
      'updateFromMessage',
    ]);
    expect(result.package?.manifest.composeExtensions[0]?.commands[0]?.contexts).toEqual(['compose', 'commandBox']);
    expect(result.package?.manifest.composeExtensions[0]?.commands[1]?.contexts).toEqual(['message']);
    expect(result.package?.manifest.activities.activityTypes).toHaveLength(5);
    expect(JSON.stringify(result.package?.manifest)).not.toContain('channel-routing');
  });

  it('T118/T120/T122/T124/T126/T128/T130/T132/T134/T136/T138/T142: rejects missing or unready selected profiles before package generation', async () => {
    const missingIntegration = await getTeamsAppPackageStatus();
    expect(missingIntegration).toEqual({
      success: false,
      error: 'Teams is not configured for this tenant',
    });

    teamsIntegrations.push({
      tenant: 'tenant-1',
      selected_profile_id: null,
      install_status: 'not_configured',
    });

    const missingSelection = await getTeamsAppPackageStatus();
    expect(missingSelection).toEqual({
      success: false,
      error: 'Select a Microsoft profile before generating a Teams package',
    });

    teamsIntegrations[0].selected_profile_id = 'profile-1';
    addMicrosoftProfile({
      tenant: 'tenant-1',
      profileId: 'profile-1',
      displayName: 'Archived Profile',
      clientId: 'archived-client-id',
      tenantId: 'archived-tenant-guid',
      secretRef: 'archived-secret-ref',
      archived: true,
    });

    const archivedProfile = await getTeamsAppPackageStatus();
    expect(archivedProfile).toEqual({
      success: false,
      error: 'Selected Microsoft profile is unavailable for Teams package generation',
    });

    microsoftProfiles.length = 0;
    addMicrosoftProfile({
      tenant: 'tenant-1',
      profileId: 'profile-1',
      displayName: 'Incomplete Profile',
      clientId: 'incomplete-client-id',
      tenantId: 'incomplete-tenant-guid',
      secretRef: 'incomplete-secret-ref',
    });

    const unreadyProfile = await getTeamsAppPackageStatus();
    expect(unreadyProfile).toEqual({
      success: false,
      error: 'Selected Microsoft profile is not ready for Teams package generation',
    });
  });
});
