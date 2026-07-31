import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../teamsWorkflowRuntimeSupport', async (importOriginal) => {
  const original = await importOriginal<typeof import('../teamsWorkflowRuntimeSupport')>();
  return {
    ...original,
    fetchGraphAppToken: vi.fn(),
    sendActivityNotification: vi.fn(),
    sendConversationMessage: vi.fn(),
    createChannelConversation: vi.fn()
  };
});

const baseCtx = {
  runId: 'run-1',
  stepPath: 'root.steps[0]',
  idempotencyKey: 'idem-1',
  attempt: 1,
  nowIso: () => new Date().toISOString(),
  env: {}
};

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';

type KnexFixture = {
  addonActive?: boolean;
  installStatus?: string | null;
  capabilities?: string[];
  profileArchived?: boolean;
  microsoftAccountId?: string | null;
  personalReference?: { conversation_id: string; service_url: string } | null;
  anyServiceUrl?: string | null;
};

const buildKnex = (fixture: KnexFixture = {}): any => {
  const {
    addonActive = true,
    installStatus = 'active',
    capabilities = ['activity_notifications', 'personal_bot'],
    profileArchived = false,
    microsoftAccountId = 'aad-user-1',
    personalReference = { conversation_id: 'conv-1', service_url: 'https://smba.trafficmanager.net/amer/' },
    anyServiceUrl = 'https://smba.trafficmanager.net/amer/'
  } = fixture;

  const knex: any = vi.fn((table: string) => {
    if (table === 'tenant_addons') {
      return {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(addonActive ? { addon_key: 'teams' } : undefined)
      };
    }
    if (table === 'teams_integrations') {
      return {
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(
          installStatus === null
            ? undefined
            : {
                install_status: installStatus,
                selected_profile_id: 'prof-1',
                app_id: 'app-guid',
                package_metadata: { baseUrl: 'https://psa.example.com' },
                enabled_capabilities: capabilities
              }
        )
      };
    }
    if (table === 'microsoft_profiles') {
      return {
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({
          profile_id: 'prof-1',
          client_id: 'client-1',
          tenant_id: 'authority-1',
          client_secret_ref: 'teams_profile_secret',
          is_archived: profileArchived
        })
      };
    }
    if (table === 'user_auth_accounts') {
      return {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(
          microsoftAccountId ? { provider_account_id: microsoftAccountId } : undefined
        )
      };
    }
    if (table === 'teams_conversation_references') {
      return {
        where: vi.fn().mockImplementation(function (this: any, criteria: Record<string, unknown>) {
          this._scoped = Boolean(criteria.conversation_type);
          return this;
        }),
        orderBy: vi.fn().mockReturnThis(),
        first: vi.fn().mockImplementation(async function (this: any, columns?: unknown) {
          if (Array.isArray(columns)) {
            return personalReference ?? undefined;
          }
          return anyServiceUrl ? { service_url: anyServiceUrl } : undefined;
        })
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
  knex.fn = { now: () => 'now()' };
  return knex;
};

const loadActionById = async (actionId: string) => {
  vi.resetModules();
  const { registerTeamsWorkflowActionsV2 } = await import('../registerTeamsWorkflowActions');
  const { getActionRegistryV2 } = await import(
    '../../../../../../../shared/workflow/runtime/registries/actionRegistry'
  );
  registerTeamsWorkflowActionsV2();
  const action = getActionRegistryV2().listById(actionId)[0];
  expect(action).toBeDefined();
  return action!;
};

const getSupportMocks = async () => {
  const supportModule = await import('../teamsWorkflowRuntimeSupport');
  return {
    fetchGraphAppToken: vi.mocked(supportModule.fetchGraphAppToken),
    sendActivityNotification: vi.mocked(supportModule.sendActivityNotification),
    sendConversationMessage: vi.mocked(supportModule.sendConversationMessage),
    createChannelConversation: vi.mocked(supportModule.createChannelConversation)
  };
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('Teams workflow action handlers (T011)', () => {
  it('notify_user sends an activity-feed notification through the Graph path', async () => {
    const action = await loadActionById('teams.notify_user');
    const mocks = await getSupportMocks();
    mocks.fetchGraphAppToken.mockResolvedValue('graph-token');
    mocks.sendActivityNotification.mockResolvedValue(undefined);

    const result = await action.handler(
      { user_id: USER_ID, title: 'Disk full on FS-01', message: 'C: at 98%', category: 'escalation' },
      { ...baseCtx, tenantId: 'tenant-1', knex: buildKnex() } as any
    );

    expect(mocks.sendActivityNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        graphToken: 'graph-token',
        recipientAadId: 'aad-user-1',
        activityType: 'workEscalated',
        topicText: 'Disk full on FS-01',
        previewText: 'C: at 98%'
      })
    );
    expect(result).toEqual({ delivered: true, user_id: USER_ID, activity_type: 'workEscalated' });
  });

  it('notify_user errors actionably when the user has no linked Microsoft account', async () => {
    const action = await loadActionById('teams.notify_user');
    await expect(
      action.handler(
        { user_id: USER_ID, title: 'Hello', category: 'assignment' },
        { ...baseCtx, tenantId: 'tenant-1', knex: buildKnex({ microsoftAccountId: null }) } as any
      )
    ).rejects.toMatchObject({
      code: 'USER_NOT_LINKED',
      message: expect.stringContaining('no linked Microsoft account')
    });
  });

  it('send_dm uses the stored personal conversation reference and errors when none exists', async () => {
    const action = await loadActionById('teams.send_dm');
    const mocks = await getSupportMocks();
    mocks.sendConversationMessage.mockResolvedValue({ activityId: 'act-1' });

    const result = await action.handler(
      { user_id: USER_ID, message: 'Ticket #42 escalated' },
      { ...baseCtx, tenantId: 'tenant-1', knex: buildKnex() } as any
    );
    expect(mocks.sendConversationMessage).toHaveBeenCalledWith({
      serviceUrl: 'https://smba.trafficmanager.net/amer/',
      conversationId: 'conv-1',
      text: 'Ticket #42 escalated'
    });
    expect(result).toEqual({ sent: true, user_id: USER_ID, conversation_id: 'conv-1' });

    await expect(
      action.handler(
        { user_id: USER_ID, message: 'hi' },
        { ...baseCtx, tenantId: 'tenant-1', knex: buildKnex({ personalReference: null }) } as any
      )
    ).rejects.toMatchObject({
      code: 'NO_CONVERSATION',
      message: expect.stringContaining('never opened the Alga bot')
    });
  });

  it('post_to_channel resolves the tenant service URL and maps app-not-in-team failures', async () => {
    const action = await loadActionById('teams.post_to_channel');
    const mocks = await getSupportMocks();
    mocks.createChannelConversation.mockResolvedValue({ conversationId: '19:abc;messageid=1', activityId: 'act-9' });

    const result = await action.handler(
      {
        channel_id: '19:abc@thread.tacv2',
        message: 'New critical alert',
        service_url: 'https://attacker-profile.trafficmanager.net/'
      } as any,
      { ...baseCtx, tenantId: 'tenant-1', knex: buildKnex() } as any
    );
    expect(mocks.createChannelConversation).toHaveBeenCalledWith({
      serviceUrl: 'https://smba.trafficmanager.net/amer/',
      channelId: '19:abc@thread.tacv2',
      text: 'New critical alert'
    });
    expect(result).toEqual({
      posted: true,
      channel_id: '19:abc@thread.tacv2',
      conversation_id: '19:abc;messageid=1'
    });

    const forbidden = Object.assign(new Error('Bot Framework request failed (403 Forbidden)'), { status: 403 });
    mocks.createChannelConversation.mockRejectedValueOnce(forbidden);
    await expect(
      action.handler(
        { channel_id: '19:other@thread.tacv2', message: 'hi' },
        { ...baseCtx, tenantId: 'tenant-1', knex: buildKnex() } as any
      )
    ).rejects.toMatchObject({
      code: 'APP_NOT_IN_TEAM',
      message: expect.stringContaining('not installed in that team')
    });
  });

  it('post_to_channel does not expose service_url in its input schema', async () => {
    const action = await loadActionById('teams.post_to_channel');

    const parsed = action.inputSchema.safeParse({
      channel_id: '19:abc@thread.tacv2',
      message: 'New critical alert',
      service_url: 'https://attacker-profile.trafficmanager.net/'
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data : null).toEqual({
      channel_id: '19:abc@thread.tacv2',
      message: 'New critical alert'
    });
  });

  it('post_to_channel errors actionably when no service URL is known for the tenant', async () => {
    const action = await loadActionById('teams.post_to_channel');
    await expect(
      action.handler(
        { channel_id: '19:abc@thread.tacv2', message: 'hi' },
        { ...baseCtx, tenantId: 'tenant-1', knex: buildKnex({ anyServiceUrl: null }) } as any
      )
    ).rejects.toMatchObject({
      code: 'NO_SERVICE_URL',
      message: expect.stringContaining('Install the Alga app in a team')
    });
  });

  it('all three actions refuse to run when the integration is not active', async () => {
    for (const [actionId, input] of [
      ['teams.notify_user', { user_id: USER_ID, title: 'x', category: 'assignment' }],
      ['teams.send_dm', { user_id: USER_ID, message: 'x' }],
      ['teams.post_to_channel', { channel_id: '19:abc@thread.tacv2', message: 'x' }]
    ] as const) {
      const action = await loadActionById(actionId);
      await expect(
        action.handler(input as any, { ...baseCtx, tenantId: 'tenant-1', knex: buildKnex({ installStatus: 'install_pending' }) } as any)
      ).rejects.toMatchObject({ code: 'INTEGRATION_INACTIVE' });
    }
  });
});

describe('Teams service URL trust checks', () => {
  it('rejects attacker-controlled trafficmanager subdomains while preserving known Teams hosts', async () => {
    const { isTrustedServiceUrl } = await import('../teamsWorkflowRuntimeSupport');

    expect(isTrustedServiceUrl('https://smba.trafficmanager.net/amer/')).toBe(true);
    expect(isTrustedServiceUrl('https://attacker-profile.trafficmanager.net/')).toBe(false);
  });
});

describe('Teams availability resolver (T012)', () => {
  const loadResolver = async () => {
    vi.resetModules();
    const { teamsIntegrationAvailability } = await import('../registerTeamsWorkflowActions');
    return teamsIntegrationAvailability;
  };

  it('is available only when the add-on is active AND the integration is installed', async () => {
    const resolver = await loadResolver();
    await expect(resolver(buildKnex(), 'tenant-1')).resolves.toBe(true);
    await expect(resolver(buildKnex({ addonActive: false }), 'tenant-1')).resolves.toBe(false);
    await expect(resolver(buildKnex({ installStatus: 'install_pending' }), 'tenant-1')).resolves.toBe(false);
    await expect(resolver(buildKnex({ installStatus: null }), 'tenant-1')).resolves.toBe(false);
  });
});
