import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = {
    addonActive: true,
    integration: {
      selected_profile_id: 'profile-1',
      install_status: 'active',
      enabled_capabilities: ['activity_notifications'],
      notification_categories: ['assignment'],
      notification_channels: null as Record<string, unknown> | string | null,
      app_id: 'teams-app-1',
      package_metadata: { baseUrl: 'https://psa.example.com' },
    } as Record<string, unknown> | null,
    profile: {
      profile_id: 'profile-1',
      client_id: 'client-1',
      tenant_id: 'aad-tenant-1',
      client_secret_ref: 'secret-ref',
      is_archived: false,
    } as Record<string, unknown> | null,
    accountLinks: [{ provider: 'microsoft', provider_account_id: 'aad-user-1' }] as Array<Record<string, string>>,
    conversationReference: {
      tenant: '22222222-2222-2222-2222-222222222222',
      microsoftUserId: 'aad-user-1',
      conversationId: 'conversation-1',
      conversationType: 'personal',
      serviceUrl: 'https://smba.trafficmanager.net/amer/',
      tenantIdAad: 'aad-tenant-1',
      channelIdBotFramework: 'msteams',
      lastActivityAt: '2026-07-01T00:00:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    } as Record<string, unknown> | null,
    deliveryRows: [] as Array<Record<string, unknown>>,
  };

  function query(table: string) {
    return {
      where() {
        return this;
      },
      andWhere(callback?: (builder: any) => void) {
        if (callback) {
          callback({
            whereNull() {
              return this;
            },
            orWhere() {
              return this;
            },
          });
        }
        return this;
      },
      async first() {
        if (table === 'tenant_addons') {
          return state.addonActive ? { addon_key: 'teams' } : undefined;
        }
        if (table === 'teams_integrations') {
          return state.integration ?? undefined;
        }
        if (table === 'microsoft_profiles') {
          return state.profile ?? undefined;
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    };
  }

  const knex = Object.assign((table: string) => query(table), {
    fn: {
      now: vi.fn(() => new Date('2026-07-06T10:00:00.000Z')),
    },
  });

  return {
    state,
    createTenantKnexMock: vi.fn(async () => ({ knex, tenant: '22222222-2222-2222-2222-222222222222' })),
    writeTeamsDeliveryRowMock: vi.fn(async (row: Record<string, unknown>) => {
      state.deliveryRows.push(row);
      return { inserted: true, idempotencyKey: `key-${state.deliveryRows.length}`, deliveryId: `delivery-${state.deliveryRows.length}` };
    }),
    fetchMicrosoftGraphAppTokenMock: vi.fn(async () => 'graph-token'),
    publishWorkflowEventMock: vi.fn(async () => undefined),
    sendBotActivityMock: vi.fn(async () => ({ status: 'sent' as const })),
    getLatestConversationReferenceMock: vi.fn(async () => state.conversationReference),
    warnMock: vi.fn(),
  };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: hoisted.createTenantKnexMock,
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
  }),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    warn: hoisted.warnMock,
  },
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getTenantSecret: vi.fn(async () => 'client-secret'),
  })),
}));

vi.mock('@alga-psa/auth', () => ({
  getSSORegistry: () => ({
    listOAuthAccountLinksForUser: vi.fn(async () => hoisted.state.accountLinks),
  }),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: (...args: unknown[]) => hoisted.publishWorkflowEventMock(...args),
}));

vi.mock('@alga-psa/workflow-streams', () => ({
  buildNotificationDeliveredPayload: (value: unknown) => value,
  buildNotificationFailedPayload: (value: unknown) => value,
  buildNotificationSentPayload: (value: unknown) => value,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/graphAuth', () => ({
  fetchMicrosoftGraphAppToken: (...args: unknown[]) => hoisted.fetchMicrosoftGraphAppTokenMock(...args),
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/notifications/teamsDeliveryRecorder', () => ({
  writeTeamsDeliveryRow: (...args: unknown[]) => hoisted.writeTeamsDeliveryRowMock(...args),
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/bot/teamsBotConnector', () => ({
  sendBotActivity: (...args: unknown[]) => hoisted.sendBotActivityMock(...args),
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/bot/teamsConversationReferences', () => ({
  getLatestTeamsConversationReferenceImpl: (...args: unknown[]) => hoisted.getLatestConversationReferenceMock(...args),
}));

import { deliverTeamsNotificationImpl } from '@alga-psa/ee-microsoft-teams/lib/notifications/teamsNotificationDelivery';

function notification(overrides: Record<string, unknown> = {}) {
  return {
    tenant: '22222222-2222-2222-2222-222222222222',
    internal_notification_id: '11111111-1111-1111-1111-111111111111',
    user_id: '33333333-3333-3333-3333-333333333333',
    template_name: 'ticket-assigned',
    title: 'Ticket assigned',
    message: 'A ticket was assigned to you',
    link: '/msp/tickets/ticket-1',
    metadata: { attempt_number: 1 },
    ...overrides,
  };
}

function graphResponse(status: number, requestId = 'request-1') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    headers: {
      get: (name: string) => (name === 'request-id' ? requestId : null),
    },
    text: vi.fn(async () => ''),
  } as unknown as Response;
}

describe('deliverTeamsNotificationImpl per-category channel routing (F044/F045)', () => {
  beforeEach(() => {
    hoisted.state.addonActive = true;
    hoisted.state.integration = {
      selected_profile_id: 'profile-1',
      install_status: 'active',
      enabled_capabilities: ['activity_notifications'],
      notification_categories: ['assignment'],
      notification_channels: null,
      app_id: 'teams-app-1',
      package_metadata: { baseUrl: 'https://psa.example.com' },
    };
    hoisted.state.profile = {
      profile_id: 'profile-1',
      client_id: 'client-1',
      tenant_id: 'aad-tenant-1',
      client_secret_ref: 'secret-ref',
      is_archived: false,
    };
    hoisted.state.accountLinks = [{ provider: 'microsoft', provider_account_id: 'aad-user-1' }];
    hoisted.state.conversationReference = {
      tenant: '22222222-2222-2222-2222-222222222222',
      microsoftUserId: 'aad-user-1',
      conversationId: 'conversation-1',
      conversationType: 'personal',
      serviceUrl: 'https://smba.trafficmanager.net/amer/',
      tenantIdAad: 'aad-tenant-1',
      channelIdBotFramework: 'msteams',
      lastActivityAt: '2026-07-01T00:00:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    };
    hoisted.state.deliveryRows.length = 0;
    hoisted.writeTeamsDeliveryRowMock.mockClear();
    hoisted.fetchMicrosoftGraphAppTokenMock.mockClear();
    hoisted.publishWorkflowEventMock.mockClear();
    hoisted.sendBotActivityMock.mockReset();
    hoisted.sendBotActivityMock.mockResolvedValue({ status: 'sent' as const });
    hoisted.getLatestConversationReferenceMock.mockReset();
    hoisted.getLatestConversationReferenceMock.mockImplementation(async () => hoisted.state.conversationReference);
    hoisted.warnMock.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => graphResponse(200, 'request-200')));
  });

  it('T076: bot_dm preference sends a proactive Adaptive Card DM and records a bot_dm delivered row', async () => {
    hoisted.state.integration = {
      ...hoisted.state.integration,
      notification_channels: { assignment: 'bot_dm' },
    };

    const result = await deliverTeamsNotificationImpl(notification());

    expect(result).toEqual({
      status: 'delivered',
      category: 'assignment',
      providerMessageId: null,
    });

    expect(hoisted.getLatestConversationReferenceMock).toHaveBeenCalledWith({
      tenant: '22222222-2222-2222-2222-222222222222',
      microsoftUserId: 'aad-user-1',
    });

    expect(hoisted.sendBotActivityMock).toHaveBeenCalledTimes(1);
    const sendInput = hoisted.sendBotActivityMock.mock.calls[0][0] as {
      serviceUrl: string;
      conversationId: string;
      activity: {
        type: string;
        text: string;
        attachments: Array<{ contentType: string; content: Record<string, any> }>;
      };
    };
    expect(sendInput.serviceUrl).toBe('https://smba.trafficmanager.net/amer/');
    expect(sendInput.conversationId).toBe('conversation-1');
    expect(sendInput.activity.type).toBe('message');
    expect(sendInput.activity.attachments).toHaveLength(1);
    const attachment = sendInput.activity.attachments[0];
    expect(attachment.contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(attachment.content.type).toBe('AdaptiveCard');
    expect(attachment.content.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'TextBlock', text: 'Ticket assigned' }),
        expect.objectContaining({ type: 'TextBlock', text: 'A ticket was assigned to you' }),
      ])
    );
    const actions = attachment.content.actions as Array<{ type: string; title: string; url: string }>;
    expect(actions[0]).toMatchObject({ type: 'Action.OpenUrl', title: 'Open in Alga PSA' });
    expect(actions[0].url).toContain('https://teams.microsoft.com/l/entity/');
    expect(actions[1]).toMatchObject({
      type: 'Action.OpenUrl',
      url: 'https://psa.example.com/msp/tickets/ticket-1',
    });

    expect(hoisted.state.deliveryRows).toHaveLength(1);
    expect(hoisted.state.deliveryRows[0]).toMatchObject({
      status: 'delivered',
      destinationType: 'bot_dm',
      destinationId: 'aad-user-1',
      providerMessageId: null,
      category: 'assignment',
    });
  });

  it('T077: bot_dm preference without a conversation reference records a typed skipped row and sends nothing', async () => {
    hoisted.state.integration = {
      ...hoisted.state.integration,
      notification_channels: { assignment: 'bot_dm' },
    };
    hoisted.state.conversationReference = null;
    hoisted.getLatestConversationReferenceMock.mockResolvedValue(null);

    const result = await deliverTeamsNotificationImpl(notification());

    expect(result).toEqual({ status: 'skipped', reason: 'missing_conversation_reference' });
    expect(hoisted.sendBotActivityMock).not.toHaveBeenCalled();
    // No Graph activity-feed call either.
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(hoisted.fetchMicrosoftGraphAppTokenMock).not.toHaveBeenCalled();

    expect(hoisted.state.deliveryRows).toHaveLength(1);
    expect(hoisted.state.deliveryRows[0]).toMatchObject({
      status: 'skipped',
      destinationType: 'bot_dm',
      destinationId: 'aad-user-1',
      errorCode: 'user_not_mapped',
      errorMessage: 'missing_conversation_reference',
      retryable: false,
    });
  });

  it('T078: bot_dm preference never calls the Graph activity-feed endpoint', async () => {
    hoisted.state.integration = {
      ...hoisted.state.integration,
      notification_channels: { assignment: 'bot_dm' },
    };

    await deliverTeamsNotificationImpl(notification());

    expect(hoisted.sendBotActivityMock).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(hoisted.fetchMicrosoftGraphAppTokenMock).not.toHaveBeenCalled();
  });

  it('T078: activity_feed preference (explicit) never calls the bot connector', async () => {
    hoisted.state.integration = {
      ...hoisted.state.integration,
      notification_channels: { assignment: 'activity_feed' },
    };

    const result = await deliverTeamsNotificationImpl(notification());

    expect(result).toMatchObject({ status: 'delivered', providerMessageId: 'request-200' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(String((globalThis.fetch as any).mock.calls[0][0])).toContain('/teamwork/sendActivityNotification');
    expect(hoisted.sendBotActivityMock).not.toHaveBeenCalled();
    expect(hoisted.getLatestConversationReferenceMock).not.toHaveBeenCalled();
    expect(hoisted.state.deliveryRows).toHaveLength(1);
    expect(hoisted.state.deliveryRows[0]).toMatchObject({
      status: 'delivered',
      destinationType: 'user_activity',
    });
  });

  it('T078: absent channel preference defaults to activity feed only', async () => {
    const result = await deliverTeamsNotificationImpl(notification());

    expect(result).toMatchObject({ status: 'delivered', providerMessageId: 'request-200' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(hoisted.sendBotActivityMock).not.toHaveBeenCalled();
    expect(hoisted.state.deliveryRows).toHaveLength(1);
    expect(hoisted.state.deliveryRows[0]).toMatchObject({ destinationType: 'user_activity' });
  });

  it('T079: both preference delivers on both channels and records two rows with distinct destination types', async () => {
    hoisted.state.integration = {
      ...hoisted.state.integration,
      notification_channels: { assignment: 'both' },
    };

    const result = await deliverTeamsNotificationImpl(notification());

    expect(result).toMatchObject({ status: 'delivered', providerMessageId: 'request-200' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(hoisted.sendBotActivityMock).toHaveBeenCalledTimes(1);

    expect(hoisted.state.deliveryRows).toHaveLength(2);
    const destinationTypes = hoisted.state.deliveryRows.map((row) => row.destinationType).sort();
    expect(destinationTypes).toEqual(['bot_dm', 'user_activity']);
    expect(hoisted.state.deliveryRows.every((row) => row.status === 'delivered')).toBe(true);
  });

  it('T079: both preference still returns the activity-feed result when the bot DM fails, with both rows written', async () => {
    hoisted.state.integration = {
      ...hoisted.state.integration,
      notification_channels: { assignment: 'both' },
    };
    hoisted.sendBotActivityMock.mockRejectedValue(new Error('bot framework unavailable'));

    const result = await deliverTeamsNotificationImpl(notification());

    expect(result).toMatchObject({ status: 'delivered', providerMessageId: 'request-200' });
    expect(hoisted.state.deliveryRows).toHaveLength(2);
    expect(hoisted.state.deliveryRows.find((row) => row.destinationType === 'user_activity')).toMatchObject({
      status: 'delivered',
    });
    expect(hoisted.state.deliveryRows.find((row) => row.destinationType === 'bot_dm')).toMatchObject({
      status: 'failed',
      errorCode: 'transient',
      errorMessage: 'bot framework unavailable',
      retryable: true,
    });
  });

  it('records a failed retryable bot_dm row and returns a typed failure when the DM send throws in bot_dm-only mode', async () => {
    hoisted.state.integration = {
      ...hoisted.state.integration,
      notification_channels: { assignment: 'bot_dm' },
    };
    hoisted.sendBotActivityMock.mockRejectedValue(new Error('bot framework unavailable'));

    const result = await deliverTeamsNotificationImpl(notification());

    expect(result).toEqual({
      status: 'failed',
      category: 'assignment',
      errorCode: 'teams_bot_delivery_failed',
      errorMessage: 'bot framework unavailable',
      retryable: true,
    });
    expect(hoisted.state.deliveryRows).toHaveLength(1);
    expect(hoisted.state.deliveryRows[0]).toMatchObject({
      status: 'failed',
      destinationType: 'bot_dm',
      errorCode: 'transient',
      retryable: true,
    });
  });

  it('records a skipped bot_dm row when the bot connector reports it cannot send', async () => {
    hoisted.state.integration = {
      ...hoisted.state.integration,
      notification_channels: { assignment: 'bot_dm' },
    };
    hoisted.sendBotActivityMock.mockResolvedValue({
      status: 'skipped' as const,
      reason: 'teams_bot_credentials_not_configured',
    });

    const result = await deliverTeamsNotificationImpl(notification());

    expect(result).toEqual({ status: 'skipped', reason: 'teams_bot_credentials_not_configured' });
    expect(hoisted.state.deliveryRows).toHaveLength(1);
    expect(hoisted.state.deliveryRows[0]).toMatchObject({
      status: 'skipped',
      destinationType: 'bot_dm',
      errorCode: 'package_misconfigured',
      errorMessage: 'teams_bot_credentials_not_configured',
      retryable: false,
    });
  });
});
