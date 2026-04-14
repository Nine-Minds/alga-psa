import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    app_id?: string | null;
    bot_id?: string | null;
    package_metadata?: Record<string, unknown> | null;
    updated_by?: string | null;
    updated_at?: string | Date;
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
      async update(values: Record<string, unknown>) {
        const rows = filteredRows();
        rows.forEach((row) => Object.assign(row, values));
        return rows.length;
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

vi.mock('@alga-psa/integrations/actions/integrations/providerReadiness', () => ({
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
import {
  buildTeamsBotResultDeepLinkFromPsaUrl,
  buildTeamsMessageExtensionResultDeepLinkFromPsaUrl,
  buildTeamsPersonalTabDeepLinkFromPsaUrl,
} from '@alga-psa/ee-microsoft-teams/lib/teams/teamsDeepLinks';

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
  const originalEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    hoisted.state.mockUser = { user_id: 'user-1', user_type: 'internal' };
    hoisted.state.mockCtx = { tenant: 'tenant-1' };
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    microsoftProfiles.length = 0;
    teamsIntegrations.length = 0;
    tenantSecrets.clear();
    appSecrets.clear();
    hasPermissionMock.mockClear();
    hasPermissionMock.mockResolvedValue(true);
  });

  afterEach(() => {
    if (originalEdition === undefined) {
      delete process.env.NEXT_PUBLIC_EDITION;
    } else {
      process.env.NEXT_PUBLIC_EDITION = originalEdition;
    }
  });

  it('T031/T035/T433: returns EE-unavailable package results in CE mode before loading Teams state', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'community';

    const result = await getTeamsAppPackageStatus();

    expect(result).toEqual({
      success: false,
      error: 'Microsoft Teams integration is only available in Enterprise Edition.',
    });
    expect(hasPermissionMock).not.toHaveBeenCalled();
  });

  it('T117/T119/T121/T123/T125/T127/T129/T131/T133/T135/T137/T141/T147/T207/T208/T209/T210/T349/T389/T390/T391/T392/T393/T394/T443: returns Teams manifest metadata with the full EE-only v1 surface set and no broadened product scope', async () => {
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
      deepLinks: {
        myWork: expect.stringContaining('/l/entity/teams-client-id/alga-psa-personal-tab'),
        ticketTemplate: expect.stringContaining(encodeURIComponent('{"page":"ticket","ticketId":"{ticketId}"}')),
        projectTaskTemplate: expect.stringContaining(encodeURIComponent('{"page":"project_task","projectId":"{projectId}","taskId":"{taskId}"}')),
        approvalTemplate: expect.stringContaining(encodeURIComponent('{"page":"approval","approvalId":"{approvalId}"}')),
        timeEntryTemplate: expect.stringContaining(encodeURIComponent('{"page":"time_entry","entryId":"{entryId}"}')),
        contactTemplate: expect.stringContaining(encodeURIComponent('{"page":"contact","contactId":"{contactId}"}')),
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
    expect(result.package?.manifest.authorization).toEqual({
      permissions: {
        resourceSpecific: [
          {
            type: 'Application',
            name: 'TeamsActivity.Send.User',
          },
        ],
      },
    });
    expect(JSON.stringify(result.package?.manifest)).not.toContain('channel-routing');
    expect(result.package?.deepLinks.ticketTemplate).toContain(encodeURIComponent('https://tenant.example.com/msp/tickets/{ticketId}'));
    expect(result.package?.deepLinks.projectTaskTemplate).toContain(encodeURIComponent('https://tenant.example.com/msp/projects/{projectId}?taskId=%7BtaskId%7D'));
    expect(result.package?.deepLinks.approvalTemplate).toContain(encodeURIComponent('https://tenant.example.com/msp/approvals/{approvalId}'));
    expect(teamsIntegrations[0]).toMatchObject({
      tenant: 'tenant-1',
      selected_profile_id: 'profile-1',
      install_status: 'install_pending',
      app_id: 'teams-client-id',
      bot_id: 'teams-client-id',
      package_metadata: {
        manifestVersion: '1.24',
        packageVersion: '1.0.0',
        fileName: 'alga-psa-teams-tenant-1.zip',
        baseUrl: 'https://tenant.example.com',
        validDomains: ['tenant.example.com', 'token.botframework.com'],
        webApplicationInfo: {
          id: 'teams-client-id',
          resource: 'api://tenant.example.com/teams/teams-client-id',
        },
      },
      updated_by: 'user-1',
    });
  });

  it('T118/T120/T122/T124/T126/T128/T130/T132/T134/T136/T138/T142/T148: rejects missing or unready selected profiles before package generation so no stale Teams deep-link targets are exposed', async () => {
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

  it('T211/T301: converts notification-style PSA record URLs into Teams personal-tab deep links so activity-feed notifications can target the correct destination without duplicating record-link rules', () => {
    expect(
      buildTeamsPersonalTabDeepLinkFromPsaUrl(
        'https://tenant.example.com',
        'teams-client-id',
        '/msp/tickets/ticket-123'
      )
    ).toContain(encodeURIComponent('{"page":"ticket","ticketId":"ticket-123"}'));

    expect(
      buildTeamsPersonalTabDeepLinkFromPsaUrl(
        'https://tenant.example.com',
        'teams-client-id',
        '/msp/projects/project-44?taskId=task-88'
      )
    ).toContain(encodeURIComponent('{"page":"project_task","projectId":"project-44","taskId":"task-88"}'));

    expect(
      buildTeamsPersonalTabDeepLinkFromPsaUrl(
        'https://tenant.example.com',
        'teams-client-id',
        '/msp/time-sheet-approvals?approvalId=approval-2'
      )
    ).toContain(encodeURIComponent('{"page":"approval","approvalId":"approval-2"}'));
  });

  it('T212/T302: falls back notification-style Teams deep links to my-work when the PSA URL is malformed or not a supported Teams destination', () => {
    const unsupported = buildTeamsPersonalTabDeepLinkFromPsaUrl(
      'https://tenant.example.com',
      'teams-client-id',
      '/msp/documents?doc=document-7'
    );

    const malformed = buildTeamsPersonalTabDeepLinkFromPsaUrl(
      'https://tenant.example.com',
      'teams-client-id',
      'not a url'
    );

    expect(unsupported).toContain(encodeURIComponent('{"page":"my_work"}'));
    expect(malformed).toContain(encodeURIComponent('{"page":"my_work"}'));
  });

  it('T213/T215: emits bot-result and message-extension-result deep links that preserve the same destination context while tagging the invoking Teams surface', () => {
    const botTicket = buildTeamsBotResultDeepLinkFromPsaUrl(
      'https://tenant.example.com',
      'teams-client-id',
      '/msp/tickets/ticket-123'
    );
    const messageExtensionContact = buildTeamsMessageExtensionResultDeepLinkFromPsaUrl(
      'https://tenant.example.com',
      'teams-client-id',
      '/msp/contacts/contact-5'
    );

    expect(botTicket).toContain(encodeURIComponent('{"page":"ticket","ticketId":"ticket-123","source":"bot"}'));
    expect(messageExtensionContact).toContain(
      encodeURIComponent('{"page":"contact","contactId":"contact-5","source":"message_extension"}')
    );
  });

  it('T214/T216: falls back bot-result and message-extension-result deep links to my-work when the supplied PSA URL is malformed or unsupported', () => {
    const unsupportedBot = buildTeamsBotResultDeepLinkFromPsaUrl(
      'https://tenant.example.com',
      'teams-client-id',
      '/msp/projects/project-44'
    );
    const malformedMessageExtension = buildTeamsMessageExtensionResultDeepLinkFromPsaUrl(
      'https://tenant.example.com',
      'teams-client-id',
      'not a url'
    );

    expect(unsupportedBot).toContain(encodeURIComponent('{"page":"my_work","source":"bot"}'));
    expect(malformedMessageExtension).toContain(
      encodeURIComponent('{"page":"my_work","source":"message_extension"}')
    );
  });
});
