import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = {
    hasPermission: true,
    hasAddon: true,
    integrations: [] as Array<Record<string, unknown>>,
    conversationReferences: [] as Array<Record<string, unknown>>,
    accountLinks: [] as Array<{ provider: string; provider_account_id: string | null }>,
    deliveries: [] as Array<Record<string, unknown>>,
    isBotConfigured: true,
  };

  const fn = {
    now: () => 'now()',
  };

  function buildTenantAddonQuery() {
    const chain: any = {
      where: () => chain,
      andWhere: (callback: (builder: any) => void) => {
        callback({
          whereNull: () => ({
            orWhere: () => undefined,
          }),
        });
        return chain;
      },
      first: async () => (state.hasAddon ? { addon_key: 'teams' } : undefined),
    };
    return chain;
  }

  function buildIntegrationQuery() {
    const filters: Record<string, unknown> = {};
    const chain: any = {
      where: (criteria: Record<string, unknown>) => {
        Object.assign(filters, criteria);
        return chain;
      },
      first: async () =>
        state.integrations.find((row) =>
          Object.entries(filters).every(([key, value]) => row[key] === value)
        ),
    };
    return chain;
  }

  function buildConversationReferenceQuery() {
    const filters: Record<string, unknown> = {};
    let orderColumn: string | null = null;
    const chain: any = {
      where: (criteria: Record<string, unknown>) => {
        Object.assign(filters, criteria);
        return chain;
      },
      orderBy: (column: string) => {
        orderColumn = column;
        return chain;
      },
      first: async () => {
        let rows = state.conversationReferences.filter((row) =>
          Object.entries(filters).every(([key, value]) => row[key] === value)
        );
        if (orderColumn) {
          rows = [...rows].sort(
            (a, b) => Date.parse(String(b[orderColumn!] ?? '')) - Date.parse(String(a[orderColumn!] ?? ''))
          );
        }
        return rows[0];
      },
    };
    return chain;
  }

  function buildDeliveryInsert(row: Record<string, unknown>) {
    const chain: any = {
      onConflict: () => chain,
      ignore: () => chain,
      returning: async () => {
        state.deliveries.push(row);
        return [{ delivery_id: row.delivery_id }];
      },
    };
    return chain;
  }

  const knex: any = (table: string) => {
    if (table === 'tenant_addons') return buildTenantAddonQuery();
    if (table === 'teams_integrations') return buildIntegrationQuery();
    if (table === 'teams_conversation_references') return buildConversationReferenceQuery();
    if (table === 'teams_notification_deliveries') {
      return {
        insert: buildDeliveryInsert,
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  };
  knex.fn = fn;

  return {
    state,
    knex,
    createTenantKnexMock: vi.fn(async (tenant?: string) => ({ knex, tenant })),
    hasPermissionMock: vi.fn(async () => state.hasPermission),
    listOAuthAccountLinksForUserMock: vi.fn(async () => state.accountLinks),
    isBotConnectorConfiguredMock: vi.fn(() => state.isBotConfigured),
    sendBotActivityMock: vi.fn(async () => ({ status: 'sent' as const })),
  };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: hoisted.createTenantKnexMock,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hoisted.hasPermissionMock,
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (fn: unknown) => fn,
}));

vi.mock('@alga-psa/auth', () => ({
  getSSORegistry: () => ({
    listOAuthAccountLinksForUser: hoisted.listOAuthAccountLinksForUserMock,
  }),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    warn: vi.fn(),
  },
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/bot/teamsBotConnector', () => ({
  isBotConnectorConfigured: hoisted.isBotConnectorConfiguredMock,
  sendBotActivity: hoisted.sendBotActivityMock,
}));

import { sendTeamsTestMessageImpl } from '@alga-psa/ee-microsoft-teams/lib/actions/integrations/teamsDiagnosticsActions';

const TENANT = '22222222-2222-2222-2222-222222222222';
const USER = {
  user_id: 'psa-user-1',
  user_type: 'internal',
};

function activeIntegration(capabilities: string[] = ['personal_bot', 'activity_notifications']) {
  hoisted.state.integrations.push({
    tenant: TENANT,
    install_status: 'active',
    enabled_capabilities: capabilities,
  });
}

function microsoftLink(microsoftUserId = 'aad-user-1') {
  hoisted.state.accountLinks.push({
    provider: 'microsoft',
    provider_account_id: microsoftUserId,
  });
}

function conversationReference(overrides: Record<string, unknown> = {}) {
  hoisted.state.conversationReferences.push({
    tenant: TENANT,
    microsoft_user_id: 'aad-user-1',
    conversation_id: 'conversation-1',
    conversation_type: 'personal',
    service_url: 'https://smba.trafficmanager.net/amer/',
    last_activity_at: '2026-05-24T10:00:00.000Z',
    ...overrides,
  });
}

async function send() {
  return sendTeamsTestMessageImpl(USER, { tenant: TENANT });
}

describe('Teams diagnostics test message action', () => {
  beforeEach(() => {
    process.env.EDITION = 'enterprise';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    hoisted.state.hasPermission = true;
    hoisted.state.hasAddon = true;
    hoisted.state.integrations.length = 0;
    hoisted.state.conversationReferences.length = 0;
    hoisted.state.accountLinks.length = 0;
    hoisted.state.deliveries.length = 0;
    hoisted.state.isBotConfigured = true;
    hoisted.createTenantKnexMock.mockClear();
    hoisted.hasPermissionMock.mockClear();
    hoisted.listOAuthAccountLinksForUserMock.mockClear();
    hoisted.isBotConnectorConfiguredMock.mockClear();
    hoisted.sendBotActivityMock.mockClear();
  });

  it('denies callers that lack the Teams settings permission', async () => {
    hoisted.state.hasPermission = false;

    await expect(send()).rejects.toThrow('Forbidden');
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(USER, 'system_settings', 'update');
  });

  it("records skipped addon_inactive and does not send when the add-on isn't active", async () => {
    hoisted.state.hasAddon = false;

    await expect(send()).resolves.toMatchObject({
      status: 'skipped',
      reason: 'addon_inactive',
    });
    expect(hoisted.sendBotActivityMock).not.toHaveBeenCalled();
    expect(hoisted.state.deliveries).toHaveLength(1);
    expect(hoisted.state.deliveries[0]).toMatchObject({
      tenant: TENANT,
      category: 'test',
      destination_type: 'bot_test',
      status: 'skipped',
      error_code: 'addon_inactive',
    });
  });

  it('returns integration_inactive when the integration is not active', async () => {
    hoisted.state.integrations.push({
      tenant: TENANT,
      install_status: 'install_pending',
      enabled_capabilities: ['personal_bot'],
    });

    await expect(send()).resolves.toMatchObject({
      status: 'skipped',
      reason: 'integration_inactive',
    });
  });

  it('returns capability_disabled when personal_bot is disabled', async () => {
    activeIntegration(['activity_notifications']);

    await expect(send()).resolves.toMatchObject({
      status: 'skipped',
      reason: 'capability_disabled',
    });
  });

  it('returns bot_not_configured without attempting Bot Framework send', async () => {
    activeIntegration();
    hoisted.state.isBotConfigured = false;

    await expect(send()).resolves.toMatchObject({
      status: 'skipped',
      reason: 'bot_not_configured',
    });
    expect(hoisted.sendBotActivityMock).not.toHaveBeenCalled();
  });

  it('returns missing_user_linkage when the admin has no Microsoft account link', async () => {
    activeIntegration();

    await expect(send()).resolves.toMatchObject({
      status: 'skipped',
      reason: 'missing_user_linkage',
    });
  });

  it('returns missing_conversation_reference with actionable guidance', async () => {
    activeIntegration();
    microsoftLink();

    await expect(send()).resolves.toMatchObject({
      status: 'skipped',
      reason: 'missing_conversation_reference',
      detail: 'Open the Alga PSA bot in Teams and send it any message first, then retry.',
    });
  });

  it('sends the proactive test activity to the stored conversation reference', async () => {
    activeIntegration();
    microsoftLink();
    conversationReference();

    await expect(send()).resolves.toMatchObject({ status: 'sent' });
    expect(hoisted.sendBotActivityMock).toHaveBeenCalledWith({
      serviceUrl: 'https://smba.trafficmanager.net/amer/',
      conversationId: 'conversation-1',
      activity: expect.objectContaining({
        type: 'message',
        text: 'Alga PSA Teams test message',
        attachments: [
          expect.objectContaining({
            content: expect.objectContaining({
              title: 'Alga PSA Teams test message',
            }),
          }),
        ],
      }),
    });
  });

  it('records a sent bot_test delivery row with the Microsoft user destination', async () => {
    activeIntegration();
    microsoftLink('aad-user-1');
    conversationReference();

    await send();

    expect(hoisted.state.deliveries).toHaveLength(1);
    expect(hoisted.state.deliveries[0]).toMatchObject({
      tenant: TENANT,
      internal_notification_id: null,
      category: 'test',
      destination_type: 'bot_test',
      destination_id: 'aad-user-1',
      attempt_number: 1,
      status: 'sent',
      error_code: null,
    });
  });

  it('records failed delivery and returns failed when Bot Framework send throws', async () => {
    activeIntegration();
    microsoftLink();
    conversationReference();
    hoisted.sendBotActivityMock.mockRejectedValueOnce(new Error('network timeout'));

    await expect(send()).resolves.toMatchObject({
      status: 'failed',
      errorMessage: 'network timeout',
    });
    expect(hoisted.state.deliveries).toHaveLength(1);
    expect(hoisted.state.deliveries[0]).toMatchObject({
      status: 'failed',
      error_code: 'transient',
      error_message: 'network timeout',
    });
  });

  it('records distinct delivery rows for consecutive test sends', async () => {
    activeIntegration();
    microsoftLink();
    conversationReference();

    await send();
    await send();

    expect(hoisted.state.deliveries).toHaveLength(2);
    expect(hoisted.state.deliveries[0].idempotency_key).not.toBe(hoisted.state.deliveries[1].idempotency_key);
  });

  it('uses the current tenant for reads and writes', async () => {
    activeIntegration();
    microsoftLink();
    conversationReference({ tenant: '33333333-3333-3333-3333-333333333333' });

    await expect(send()).resolves.toMatchObject({
      status: 'skipped',
      reason: 'missing_conversation_reference',
    });
    expect(hoisted.state.deliveries[0]).toMatchObject({
      tenant: TENANT,
      destination_id: 'aad-user-1',
    });
    expect(hoisted.sendBotActivityMock).not.toHaveBeenCalled();
  });
});
