import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getTeamsAvailabilityMock,
  resolveTeamsTabAuthStateMock,
  isBotConnectorConfiguredMock,
  sendBotActivityMock,
  findTeamsConversationReferenceByConversationIdMock,
} = vi.hoisted(() => ({
  getTeamsAvailabilityMock: vi.fn(),
  resolveTeamsTabAuthStateMock: vi.fn(),
  isBotConnectorConfiguredMock: vi.fn(),
  sendBotActivityMock: vi.fn(),
  findTeamsConversationReferenceByConversationIdMock: vi.fn(),
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/teamsAvailability', () => ({
  getTeamsAvailability: getTeamsAvailabilityMock,
  resolveTeamsAvailability: vi.fn(),
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/resolveTeamsTabAuthState', () => ({
  resolveTeamsTabAuthState: resolveTeamsTabAuthStateMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/bot/teamsBotConnector', () => ({
  isBotConnectorConfigured: (...args: unknown[]) => isBotConnectorConfiguredMock(...args),
  sendBotActivity: sendBotActivityMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/bot/teamsConversationReferences', () => ({
  findTeamsConversationReferenceByConversationId: findTeamsConversationReferenceByConversationIdMock,
}));

import { handleTeamsAuthCallback } from '@alga-psa/ee-microsoft-teams/lib/teams/handleTeamsAuthCallback';

function buildCallbackRequest(query: string): Request {
  return new Request(`https://example.test/api/teams/auth/callback/bot?${query}`, { method: 'GET' });
}

describe('Teams bot sign-in completion (F032)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

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
    isBotConnectorConfiguredMock.mockReturnValue(true);
    sendBotActivityMock.mockResolvedValue({ status: 'sent' });
    findTeamsConversationReferenceByConversationIdMock.mockResolvedValue({
      tenant: 'tenant-1',
      microsoftUserId: 'aad-user-1',
      conversationId: 'conversation-9',
      conversationType: 'personal',
      serviceUrl: 'https://smba.trafficmanager.net/amer/',
      tenantIdAad: 'entra-tenant-1',
      channelIdBotFramework: 'msteams',
      lastActivityAt: null,
      createdAt: null,
      updatedAt: null,
    });
  });

  it('T058: completing the link flow sends a proactive welcome card to the originating conversation', async () => {
    const response = await handleTeamsAuthCallback(
      buildCallbackRequest('tenantId=tenant-1&conversationId=conversation-9'),
      'bot'
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('sign-in complete');

    expect(findTeamsConversationReferenceByConversationIdMock).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      conversationId: 'conversation-9',
    });
    expect(sendBotActivityMock).toHaveBeenCalledTimes(1);
    const sendInput = sendBotActivityMock.mock.calls[0][0];
    expect(sendInput.serviceUrl).toBe('https://smba.trafficmanager.net/amer/');
    expect(sendInput.conversationId).toBe('conversation-9');
    expect(sendInput.activity.attachments?.[0]?.contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(sendInput.activity.text).toContain('Alex Tech');
    expect(sendInput.activity.text).toContain('my tickets');
  });

  it('T058: retries with a hero card when the adaptive welcome card is rejected', async () => {
    sendBotActivityMock
      .mockRejectedValueOnce(new Error('Failed to send Bot Framework activity (415 Unsupported Media Type): nope'))
      .mockResolvedValueOnce({ status: 'sent' });

    const response = await handleTeamsAuthCallback(
      buildCallbackRequest('tenantId=tenant-1&conversationId=conversation-9'),
      'bot'
    );

    expect(response.status).toBe(200);
    expect(sendBotActivityMock).toHaveBeenCalledTimes(2);
    expect(sendBotActivityMock.mock.calls[1][0].activity.attachments?.[0]?.contentType).toBe(
      'application/vnd.microsoft.card.hero'
    );
  });

  it('skips the welcome card when no conversation id was carried through the flow', async () => {
    const response = await handleTeamsAuthCallback(buildCallbackRequest('tenantId=tenant-1'), 'bot');

    expect(response.status).toBe(200);
    expect(sendBotActivityMock).not.toHaveBeenCalled();
  });

  it('never fails the callback page when the welcome delivery breaks', async () => {
    findTeamsConversationReferenceByConversationIdMock.mockResolvedValue(null);

    const response = await handleTeamsAuthCallback(
      buildCallbackRequest('tenantId=tenant-1&conversationId=conversation-9'),
      'bot'
    );

    expect(response.status).toBe(200);
    expect(sendBotActivityMock).not.toHaveBeenCalled();
  });
});
