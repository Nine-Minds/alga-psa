import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The proactive welcome card goes out through the same connector as bot
 * replies, but with a plain try/catch that downgrades *any* failure to a hero
 * card. Before the expired-token replay moved into the connector, a token that
 * happened to expire mid-flow silently cost the user the Adaptive Card.
 *
 * Everything around the connector is mocked; the connector itself is real, so
 * this pins the behavior of the whole non-bot-reply path.
 */

const {
  getTeamsAvailabilityMock,
  resolveTeamsTabAuthStateMock,
  findTeamsConversationReferenceByConversationIdMock,
} = vi.hoisted(() => ({
  getTeamsAvailabilityMock: vi.fn(),
  resolveTeamsTabAuthStateMock: vi.fn(),
  findTeamsConversationReferenceByConversationIdMock: vi.fn(),
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/teamsAvailability', () => ({
  getTeamsAvailability: getTeamsAvailabilityMock,
  resolveTeamsAvailability: vi.fn(),
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/resolveTeamsTabAuthState', () => ({
  resolveTeamsTabAuthState: resolveTeamsTabAuthStateMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/bot/teamsConversationReferences', () => ({
  findTeamsConversationReferenceByConversationId:
    findTeamsConversationReferenceByConversationIdMock,
}));

const SERVICE_URL = 'https://smba.trafficmanager.net/amer/';
const TOKEN_URL = 'https://login.microsoftonline.com/bot-tenant-1/oauth2/v2.0/token';

let fetchMock: ReturnType<typeof vi.fn>;

function tokenResponse(token: string): Response {
  return new Response(JSON.stringify({ access_token: token, expires_in: 3600 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function activityResponse(status: number): Response {
  return new Response('{}', { status, statusText: status === 401 ? 'Unauthorized' : 'OK' });
}

/** Bodies of the activity POSTs only, in order. */
function sentActivities(): Array<Record<string, any>> {
  return fetchMock.mock.calls
    .filter(([url]) => String(url) !== TOKEN_URL)
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

async function runCallback(): Promise<Response> {
  const { handleTeamsAuthCallback } = await import(
    '@alga-psa/ee-microsoft-teams/lib/teams/handleTeamsAuthCallback'
  );
  return handleTeamsAuthCallback(
    new Request(
      'https://example.test/api/teams/auth/callback/bot?tenantId=tenant-1&conversationId=conversation-9',
      { method: 'GET' }
    ),
    'bot'
  );
}

beforeEach(() => {
  // Fresh module registry per test so the connector's cached token never
  // carries over.
  vi.resetModules();
  vi.clearAllMocks();

  vi.stubEnv('TEAMS_BOT_APP_ID', 'bot-app-1');
  vi.stubEnv('TEAMS_BOT_APP_TENANT_ID', 'bot-tenant-1');
  vi.stubEnv('TEAMS_BOT_APP_PASSWORD', 'bot-secret-1');

  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  getTeamsAvailabilityMock.mockResolvedValue({ enabled: true });
  resolveTeamsTabAuthStateMock.mockResolvedValue({
    status: 'ready',
    tenantId: 'tenant-1',
    userId: 'user-1',
    userName: 'Alex Tech',
    userEmail: 'alex@example.test',
    profileId: 'profile-1',
    microsoftTenantId: 'entra-tenant-1',
  });
  findTeamsConversationReferenceByConversationIdMock.mockResolvedValue({
    tenant: 'tenant-1',
    microsoftUserId: 'aad-user-1',
    conversationId: 'conversation-9',
    conversationType: 'personal',
    serviceUrl: SERVICE_URL,
    tenantIdAad: 'entra-tenant-1',
    channelIdBotFramework: 'msteams',
    lastActivityAt: null,
    createdAt: null,
    updatedAt: null,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Teams sign-in welcome card delivery', () => {
  it('keeps the Adaptive Card when the connector token expires mid-flow', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse('stale-token'))
      .mockResolvedValueOnce(activityResponse(401))
      .mockResolvedValueOnce(tokenResponse('fresh-token'))
      .mockResolvedValueOnce(activityResponse(200));

    const response = await runCallback();
    expect(response.status).toBe(200);

    const activities = sentActivities();
    expect(activities).toHaveLength(2);
    // Both attempts carry the Adaptive Card: replayed, not downgraded.
    for (const activity of activities) {
      expect(activity.attachments?.[0]?.contentType).toBe(
        'application/vnd.microsoft.card.adaptive'
      );
    }
    expect(activities[1].text).toContain('Alex Tech');
  });

  it('still downgrades to the hero card when the client rejects adaptive content', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse('token-1'))
      .mockResolvedValueOnce(activityResponse(415))
      .mockResolvedValueOnce(activityResponse(200));

    const response = await runCallback();
    expect(response.status).toBe(200);

    const activities = sentActivities();
    expect(activities).toHaveLength(2);
    expect(activities[1].attachments?.[0]?.contentType).toBe(
      'application/vnd.microsoft.card.hero'
    );
  });
});
