import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  verifyTeamsBotRequestMock,
  resolveTeamsTenantContextMock,
  resolveTeamsLinkedUserMock,
  getUserWithRolesMock,
  createTenantKnexMock,
  hasPermissionMock,
  getTeamsIntegrationExecutionStateMock,
  executeTeamsActionMock,
  listAvailableTeamsActionsMock,
  getTeamsRuntimeAvailabilityMock,
  searchTeamsTicketsMock,
  searchTeamsContactsMock,
  listPendingApprovalsForTeamsMock,
} = vi.hoisted(() => ({
  verifyTeamsBotRequestMock: vi.fn(),
  resolveTeamsTenantContextMock: vi.fn(),
  resolveTeamsLinkedUserMock: vi.fn(),
  getUserWithRolesMock: vi.fn(),
  createTenantKnexMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  getTeamsIntegrationExecutionStateMock: vi.fn(),
  executeTeamsActionMock: vi.fn(),
  listAvailableTeamsActionsMock: vi.fn(),
  getTeamsRuntimeAvailabilityMock: vi.fn(),
  searchTeamsTicketsMock: vi.fn(),
  searchTeamsContactsMock: vi.fn(),
  listPendingApprovalsForTeamsMock: vi.fn(),
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/bot/teamsBotJwtVerifier', () => ({
  verifyTeamsBotRequest: verifyTeamsBotRequestMock,
  resetTeamsBotJwksCacheForTests: vi.fn(),
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/resolveTeamsTenantContext', () => ({
  resolveTeamsTenantContext: resolveTeamsTenantContextMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/resolveTeamsLinkedUser', () => ({
  resolveTeamsLinkedUser: resolveTeamsLinkedUserMock,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  getUserWithRoles: getUserWithRolesMock,
  tenantDb: (conn: any) => ({
    table: (t: string) => conn(t),
    unscoped: (t: string) => conn(t),
  }),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/actions/integrations/teamsActions', () => ({
  getTeamsIntegrationExecutionStateImpl: getTeamsIntegrationExecutionStateMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/actions/teamsActionRegistry', () => ({
  executeTeamsAction: executeTeamsActionMock,
  listAvailableTeamsActions: listAvailableTeamsActionsMock,
  listTeamsActionDefinitions: () => [],
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/getTeamsRuntimeAvailability', () => ({
  getTeamsRuntimeAvailability: (...args: unknown[]) => getTeamsRuntimeAvailabilityMock(...args),
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/teamsPsaData', () => ({
  searchTeamsTickets: searchTeamsTicketsMock,
  searchTeamsContacts: searchTeamsContactsMock,
  listPendingApprovalsForTeams: listPendingApprovalsForTeamsMock,
}));

import { handleTeamsBotActivityRequest } from '@alga-psa/ee-microsoft-teams/lib/teams/bot/teamsBotHandler';
import { handleTeamsMessageExtensionRequest } from '@alga-psa/ee-microsoft-teams/lib/teams/messageExtension/teamsMessageExtensionHandler';
import { handleTeamsQuickActionRequest } from '@alga-psa/ee-microsoft-teams/lib/teams/quickActions/teamsQuickActionHandler';

const TRUSTED_SERVICE_URL = 'https://smba.trafficmanager.net/amer';

function buildBotActivity(overrides: Record<string, unknown> = {}) {
  return {
    type: 'message',
    text: 'my tickets',
    serviceUrl: TRUSTED_SERVICE_URL,
    from: { aadObjectId: 'aad-user-1' },
    conversation: { id: 'conversation-1', conversationType: 'personal' },
    channelData: { tenant: { id: 'entra-tenant-1' } },
    ...overrides,
  };
}

function buildQuickActionActivity(overrides: Record<string, unknown> = {}) {
  return {
    type: 'invoke',
    name: 'task/submit',
    serviceUrl: TRUSTED_SERVICE_URL,
    from: { aadObjectId: 'aad-user-1' },
    channelData: { tenant: { id: 'entra-tenant-1' } },
    value: {
      command: 'submit',
      actionId: 'add_note',
      target: { entityType: 'ticket', ticketId: 'ticket-1' },
      data: { note: 'Saved from Teams' },
    },
    ...overrides,
  };
}

function buildMessageExtensionActivity(overrides: Record<string, unknown> = {}) {
  return {
    type: 'invoke',
    name: 'composeExtension/query',
    serviceUrl: TRUSTED_SERVICE_URL,
    from: { aadObjectId: 'aad-user-1' },
    channelData: { tenant: { id: 'entra-tenant-1' } },
    value: {
      commandId: 'searchRecords',
      commandContext: 'compose',
      parameters: [{ name: 'query', value: 'printer' }],
    },
    ...overrides,
  };
}

function buildRequest(url: string, body: unknown, token?: string | null) {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function buildUser(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'user-1',
    tenant: 'tenant-1',
    user_type: 'internal',
    first_name: 'Alex',
    last_name: 'Tech',
    email: 'alex@example.test',
    roles: [],
    permissions: [],
    ...overrides,
  } as any;
}

describe('Teams inbound route security (E1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    verifyTeamsBotRequestMock.mockResolvedValue({
      status: 'verified',
      payload: { oid: 'aad-user-1', tid: 'entra-tenant-1' },
    });
    resolveTeamsTenantContextMock.mockResolvedValue({
      status: 'resolved',
      tenantId: 'tenant-1',
      installStatus: 'active',
      enabledCapabilities: ['personal_bot', 'personal_tab', 'message_extension'],
      appId: 'teams-app-1',
      botId: 'teams-app-1',
      microsoftTenantId: 'entra-tenant-1',
    });
    resolveTeamsLinkedUserMock.mockResolvedValue({
      status: 'linked',
      tenantId: 'tenant-1',
      userId: 'user-1',
      userEmail: 'alex@example.test',
      username: 'alex',
      providerAccountId: 'aad-user-1',
      matchedBy: 'provider_account_id',
    });
    getUserWithRolesMock.mockResolvedValue(buildUser());
    // Deny project reads so the message-extension search skips the raw
    // project_tasks query (its knex chain is out of scope for these tests).
    hasPermissionMock.mockImplementation(async (_user: unknown, resource: string) => resource !== 'project');
    getTeamsIntegrationExecutionStateMock.mockResolvedValue({
      selectedProfileId: 'profile-1',
      installStatus: 'active',
      enabledCapabilities: ['personal_bot', 'personal_tab', 'message_extension'],
      allowedActions: ['assign_ticket', 'add_note'],
      appId: 'teams-app-1',
      packageMetadata: { baseUrl: 'https://example.test' },
    });
    executeTeamsActionMock.mockResolvedValue({
      success: true,
      actionId: 'add_note',
      surface: 'quick_action',
      operation: 'mutation',
      summary: { title: 'Note added', text: 'A note was added.' },
      links: [],
      items: [],
      warnings: [],
      metadata: {
        surface: 'quick_action',
        idempotencyKey: null,
        idempotentReplay: false,
        invokingSurface: 'quick_action',
        businessOperations: [],
      },
    });
    listAvailableTeamsActionsMock.mockResolvedValue([]);
    getTeamsRuntimeAvailabilityMock.mockResolvedValue(null);
    searchTeamsTicketsMock.mockResolvedValue([]);
    searchTeamsContactsMock.mockResolvedValue([]);
    listPendingApprovalsForTeamsMock.mockResolvedValue([]);
    createTenantKnexMock.mockResolvedValue({
      knex: Object.assign(
        vi.fn(() => ({
          where: vi.fn().mockReturnThis(),
          andWhere: vi.fn().mockReturnThis(),
          select: vi.fn().mockResolvedValue([]),
          insert: vi.fn(() => ({
            onConflict: vi.fn(() => ({ merge: vi.fn().mockResolvedValue(undefined) })),
          })),
        })),
        { fn: { now: () => 'now()' } }
      ),
      tenant: 'tenant-1',
    });
  });

  describe('bot messages route', () => {
    it('T004-style: returns 401 for rejected JWTs and never resolves tenant or executes actions', async () => {
      verifyTeamsBotRequestMock.mockResolvedValue({ status: 'rejected', reason: 'invalid_token' });

      const response = await handleTeamsBotActivityRequest(
        buildRequest('https://example.test/api/teams/bot/messages', buildBotActivity(), 'bad-token')
      );

      expect(response.status).toBe(401);
      expect(resolveTeamsTenantContextMock).not.toHaveBeenCalled();
      expect(executeTeamsActionMock).not.toHaveBeenCalled();
    });

    it('T008/T009: fails closed with 403 naming the env vars when bot credentials are unconfigured', async () => {
      verifyTeamsBotRequestMock.mockResolvedValue({ status: 'unconfigured' });

      const response = await handleTeamsBotActivityRequest(
        buildRequest('https://example.test/api/teams/bot/messages', buildBotActivity())
      );

      expect(response.status).toBe(403);
      const payload = await response.json();
      expect(payload.error).toBe('bot_connector_not_configured');
      expect(payload.message).toContain('TEAMS_BOT_APP_ID');
      expect(payload.message).toContain('TEAMS_BOT_APP_PASSWORD');
      expect(resolveTeamsTenantContextMock).not.toHaveBeenCalled();
      expect(executeTeamsActionMock).not.toHaveBeenCalled();
    });

    it('processes verified requests end to end (happy path preserved)', async () => {
      executeTeamsActionMock.mockResolvedValue({
        success: true,
        actionId: 'my_tickets',
        surface: 'bot',
        operation: 'lookup',
        summary: { title: 'My tickets', text: 'Found 0 tickets.' },
        links: [],
        items: [],
        warnings: [],
        metadata: {
          surface: 'bot',
          idempotencyKey: null,
          idempotentReplay: false,
          invokingSurface: 'bot',
          businessOperations: [],
        },
      });

      const response = await handleTeamsBotActivityRequest(
        buildRequest('https://example.test/api/teams/bot/messages?tenantId=tenant-1', buildBotActivity(), 'good-token')
      );

      expect(response.status).toBe(200);
      expect(executeTeamsActionMock).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: 'my_tickets' })
      );
    });

    it('T010: rejects activities whose from.aadObjectId differs from the verified oid claim', async () => {
      const response = await handleTeamsBotActivityRequest(
        buildRequest(
          'https://example.test/api/teams/bot/messages',
          buildBotActivity({ from: { aadObjectId: 'spoofed-user' } }),
          'good-token'
        )
      );

      expect(response.status).toBe(401);
      expect(executeTeamsActionMock).not.toHaveBeenCalled();
    });

    it('T011: rejects activities whose channelData.tenant.id differs from the verified tid claim', async () => {
      const response = await handleTeamsBotActivityRequest(
        buildRequest(
          'https://example.test/api/teams/bot/messages',
          buildBotActivity({ channelData: { tenant: { id: 'spoofed-tenant' } } }),
          'good-token'
        )
      );

      expect(response.status).toBe(401);
      expect(executeTeamsActionMock).not.toHaveBeenCalled();
    });

    it('T012: resolves the linked user from verified claims when body identity fields are absent', async () => {
      await handleTeamsBotActivityRequest(
        buildRequest(
          'https://example.test/api/teams/bot/messages',
          buildBotActivity({ from: null }),
          'good-token'
        )
      );

      expect(resolveTeamsLinkedUserMock).toHaveBeenCalledWith(
        expect.objectContaining({ microsoftAccountId: 'aad-user-1' })
      );
    });

    it('T003 route-level: rejects untrusted serviceUrl hosts even with a valid JWT', async () => {
      const response = await handleTeamsBotActivityRequest(
        buildRequest(
          'https://example.test/api/teams/bot/messages',
          buildBotActivity({ serviceUrl: 'https://evil.example.com' }),
          'good-token'
        )
      );

      expect(response.status).toBe(401);
      expect(executeTeamsActionMock).not.toHaveBeenCalled();
    });
  });

  describe('message-extension query route', () => {
    it('T004: returns 401 for requests with no/invalid Authorization and does not invoke the handler', async () => {
      verifyTeamsBotRequestMock.mockResolvedValue({ status: 'rejected', reason: 'missing_bearer_token' });

      const response = await handleTeamsMessageExtensionRequest(
        buildRequest('https://example.test/api/teams/message-extension/query', buildMessageExtensionActivity())
      );

      expect(response.status).toBe(401);
      expect(resolveTeamsTenantContextMock).not.toHaveBeenCalled();
      expect(resolveTeamsLinkedUserMock).not.toHaveBeenCalled();
    });

    it('T005: processes a request with a valid JWT and returns search results (happy path preserved)', async () => {
      const response = await handleTeamsMessageExtensionRequest(
        buildRequest(
          'https://example.test/api/teams/message-extension/query',
          buildMessageExtensionActivity(),
          'good-token'
        )
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.composeExtension).toBeDefined();
      expect(resolveTeamsLinkedUserMock).toHaveBeenCalled();
    });

    it('fails closed with 403 when credentials are unconfigured', async () => {
      verifyTeamsBotRequestMock.mockResolvedValue({ status: 'unconfigured' });

      const response = await handleTeamsMessageExtensionRequest(
        buildRequest('https://example.test/api/teams/message-extension/query', buildMessageExtensionActivity())
      );

      expect(response.status).toBe(403);
      expect(resolveTeamsTenantContextMock).not.toHaveBeenCalled();
    });

    it('rejects identity mismatches between the body and verified claims', async () => {
      const response = await handleTeamsMessageExtensionRequest(
        buildRequest(
          'https://example.test/api/teams/message-extension/query',
          buildMessageExtensionActivity({ from: { aadObjectId: 'spoofed-user' } }),
          'good-token'
        )
      );

      expect(response.status).toBe(401);
      expect(resolveTeamsLinkedUserMock).not.toHaveBeenCalled();
    });
  });

  describe('quick-actions route', () => {
    it('T006: returns 401 for requests with no/invalid JWT for fetch, submit, and cancel invoke types', async () => {
      verifyTeamsBotRequestMock.mockResolvedValue({ status: 'rejected', reason: 'invalid_token' });

      for (const name of ['task/fetch', 'task/submit']) {
        for (const command of ['fetch', 'submit', 'cancel']) {
          const response = await handleTeamsQuickActionRequest(
            buildRequest(
              'https://example.test/api/teams/quick-actions',
              buildQuickActionActivity({
                name,
                value: {
                  command,
                  actionId: 'add_note',
                  target: { entityType: 'ticket', ticketId: 'ticket-1' },
                  data: { note: 'n' },
                },
              })
            )
          );
          expect(response.status).toBe(401);
        }
      }

      expect(executeTeamsActionMock).not.toHaveBeenCalled();
      expect(resolveTeamsTenantContextMock).not.toHaveBeenCalled();
    });

    it('T007: executes the mutation only when the JWT is valid (happy path preserved)', async () => {
      const response = await handleTeamsQuickActionRequest(
        buildRequest('https://example.test/api/teams/quick-actions', buildQuickActionActivity(), 'good-token')
      );

      expect(response.status).toBe(200);
      expect(executeTeamsActionMock).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: 'add_note', surface: 'quick_action' })
      );
    });

    it('fails closed with 403 when credentials are unconfigured', async () => {
      verifyTeamsBotRequestMock.mockResolvedValue({ status: 'unconfigured' });

      const response = await handleTeamsQuickActionRequest(
        buildRequest('https://example.test/api/teams/quick-actions', buildQuickActionActivity())
      );

      expect(response.status).toBe(403);
      expect(executeTeamsActionMock).not.toHaveBeenCalled();
    });

    it('T010 quick-actions: registry action never executes on identity mismatch', async () => {
      const response = await handleTeamsQuickActionRequest(
        buildRequest(
          'https://example.test/api/teams/quick-actions',
          buildQuickActionActivity({ from: { aadObjectId: 'spoofed-user' } }),
          'good-token'
        )
      );

      expect(response.status).toBe(401);
      expect(executeTeamsActionMock).not.toHaveBeenCalled();
    });
  });
});
