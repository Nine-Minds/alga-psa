import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = {
    hasPermission: true,
    hasAddon: true,
    integrations: [] as Array<Record<string, unknown>>,
    profiles: [] as Array<Record<string, unknown>>,
    conversationReferences: [] as Array<Record<string, unknown>>,
    accountLinks: [] as Array<{ provider: string; provider_account_id: string | null }>,
    deliveries: [] as Array<Record<string, unknown>>,
    isBotConfigured: true,
    botCredentials: { appId: 'client-1', tenantId: 'bot-tenant-1', password: 'bot-secret' },
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

  function buildProfileQuery() {
    const filters: Record<string, unknown> = {};
    const chain: any = {
      where: (criteria: Record<string, unknown>) => {
        Object.assign(filters, criteria);
        return chain;
      },
      first: async () =>
        state.profiles.find((row) =>
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

  function buildDeliveryQuery() {
    const filters: Record<string, unknown> = {};
    let allowedStatuses: string[] | null = null;
    const chain: any = {
      where: (criteria: Record<string, unknown>) => {
        Object.assign(filters, criteria);
        return chain;
      },
      modify: (callback: (builder: any) => void) => {
        callback(chain);
        return chain;
      },
      whereIn: (column: string, values: string[]) => {
        if (column === 'status') {
          allowedStatuses = values;
        }
        return chain;
      },
      orderBy: () => chain,
      first: async () => {
        let rows = state.deliveries.filter((row) =>
          Object.entries(filters).every(([key, value]) => row[key] === value)
        );
        if (allowedStatuses) {
          rows = rows.filter((row) => allowedStatuses!.includes(String(row.status)));
        }
        rows = [...rows].sort((a, b) => {
          const byCreatedAt = Date.parse(String(b.created_at ?? '')) - Date.parse(String(a.created_at ?? ''));
          if (byCreatedAt !== 0) return byCreatedAt;
          return String(b.delivery_id ?? '').localeCompare(String(a.delivery_id ?? ''));
        });
        return rows[0];
      },
    };
    return chain;
  }

  const knex: any = (table: string) => {
    if (table === 'tenant_addons') return buildTenantAddonQuery();
    if (table === 'teams_integrations') return buildIntegrationQuery();
    if (table === 'microsoft_profiles') return buildProfileQuery();
    if (table === 'teams_conversation_references') return buildConversationReferenceQuery();
    if (table === 'teams_notification_deliveries') {
      return {
        ...buildDeliveryQuery(),
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
    readBotCredentialsFromEnvMock: vi.fn(() => (state.isBotConfigured ? state.botCredentials : null)),
    sendBotActivityMock: vi.fn(async () => ({ status: 'sent' as const })),
    resolveTeamsRecordingsWebhookUrlMock: vi.fn(() => 'https://psa.example.com/api/teams/webhooks/recordings'),
  };
});

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, tenant: string) => ({
    table: (tableExpr: string) => {
      const builder = conn(tableExpr);
      if (!builder || typeof builder.where !== 'function') {
        return builder;
      }
      const aliasMatch = /\bas\s+([A-Za-z0-9_]+)\s*$/i.exec(tableExpr.trim());
      const tenantColumn = aliasMatch ? `${aliasMatch[1]}.tenant` : 'tenant';
      builder.where({ [tenantColumn]: tenant });
      return {
        ...builder,
        where: (criteria: any, ...rest: any[]) =>
          criteria && typeof criteria === 'object' && !Array.isArray(criteria)
            ? builder.where({ [tenantColumn]: tenant, ...criteria })
            : builder.where(criteria, ...rest),
      };
    },
    scoped: (t: string) => conn(t),
    subquery: (t: string) => conn(t),
    parentScopedTable: (t: string) => conn(t),
    unscoped: (t: string) => conn(t),
    tenantJoin: (q: any, t: string, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(t) ?? q) : (q.join?.(t) ?? q),
    tenantJoinSubquery: (q: any, sub: any, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(sub) ?? q) : (q.join?.(sub) ?? q),
    tenantWhereColumn: (q: any) => q,
  }),
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
  readBotCredentialsFromEnv: hoisted.readBotCredentialsFromEnvMock,
  sendBotActivity: hoisted.sendBotActivityMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/meetings/artifactSubscriptions', () => ({
  resolveTeamsRecordingsWebhookUrl: hoisted.resolveTeamsRecordingsWebhookUrlMock,
}));

import {
  runTeamsDiagnosticsImpl,
  sendTeamsTestMessageImpl,
} from '@alga-psa/ee-microsoft-teams/lib/actions/integrations/teamsDiagnosticsActions';

const TENANT = '22222222-2222-2222-2222-222222222222';
const USER = {
  user_id: 'psa-user-1',
  user_type: 'internal',
};

const fetchMock = vi.fn();

function activeIntegration(capabilities: string[] = ['personal_bot', 'activity_notifications']) {
  hoisted.state.integrations.push({
    tenant: TENANT,
    selected_profile_id: 'profile-1',
    install_status: 'active',
    enabled_capabilities: capabilities,
    app_id: 'teams-app-1',
    bot_id: 'client-1',
    package_metadata: {
      baseUrl: 'https://psa.example.com',
      webApplicationInfo: { id: 'client-1', resource: 'api://psa.example.com/teams/client-1' },
    },
    default_meeting_organizer_upn: 'scheduler@example.com',
    default_meeting_organizer_object_id: 'organizer-object-1',
    recordings_subscription_id: 'recordings-subscription-1',
    recordings_subscription_expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    transcripts_subscription_id: 'transcripts-subscription-1',
    transcripts_subscription_expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  });
}

function readyProfile(overrides: Record<string, unknown> = {}) {
  hoisted.state.profiles.push({
    tenant: TENANT,
    profile_id: 'profile-1',
    client_id: 'client-1',
    tenant_id: 'aad-tenant-1',
    client_secret_ref: 'secret-ref-1',
    is_archived: false,
    ...overrides,
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

function delivery(overrides: Record<string, unknown>) {
  hoisted.state.deliveries.push({
    tenant: TENANT,
    delivery_id: `delivery-${hoisted.state.deliveries.length + 1}`,
    internal_notification_id: null,
    category: 'test',
    destination_type: 'bot_test',
    destination_id: 'aad-user-1',
    attempt_number: 1,
    idempotency_key: `key-${hoisted.state.deliveries.length + 1}`,
    provider_message_id: null,
    status: 'sent',
    error_code: null,
    error_message: null,
    retryable: null,
    provider_request_id: null,
    sent_at: null,
    delivered_at: null,
    responded_at: null,
    created_at: '2026-05-24T10:00:00.000Z',
    ...overrides,
  });
}

async function send() {
  return sendTeamsTestMessageImpl(USER, { tenant: TENANT });
}

async function diagnose() {
  return runTeamsDiagnosticsImpl(USER, { tenant: TENANT });
}

function resetTeamsState() {
    process.env.EDITION = 'enterprise';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    hoisted.state.hasPermission = true;
    hoisted.state.hasAddon = true;
    hoisted.state.integrations.length = 0;
    hoisted.state.profiles.length = 0;
    hoisted.state.conversationReferences.length = 0;
    hoisted.state.accountLinks.length = 0;
    hoisted.state.deliveries.length = 0;
    hoisted.state.isBotConfigured = true;
    hoisted.state.botCredentials = { appId: 'client-1', tenantId: 'bot-tenant-1', password: 'bot-secret' };
    hoisted.createTenantKnexMock.mockClear();
    hoisted.hasPermissionMock.mockClear();
    hoisted.listOAuthAccountLinksForUserMock.mockClear();
    hoisted.isBotConnectorConfiguredMock.mockClear();
    hoisted.readBotCredentialsFromEnvMock.mockClear();
    hoisted.sendBotActivityMock.mockClear();
    hoisted.resolveTeamsRecordingsWebhookUrlMock.mockClear();
    hoisted.resolveTeamsRecordingsWebhookUrlMock.mockImplementation(
      () => 'https://psa.example.com/api/teams/webhooks/recordings'
    );
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 405 }));
    vi.stubGlobal('fetch', fetchMock);
}

describe('Teams diagnostics test message action', () => {
  beforeEach(() => {
    resetTeamsState();
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

describe('Teams diagnostics report action', () => {
  beforeEach(() => {
    resetTeamsState();
  });

  function healthyTenant() {
    activeIntegration();
    readyProfile();
    microsoftLink();
    conversationReference();
    delivery({
      delivery_id: 'delivery-success',
      status: 'sent',
      created_at: '2026-05-24T10:00:00.000Z',
      sent_at: '2026-05-24T10:00:00.000Z',
    });
  }

  it('denies callers that lack the Teams settings permission', async () => {
    hoisted.state.hasPermission = false;

    await expect(diagnose()).rejects.toThrow('Forbidden');
  });

  it('returns the expected ordered steps with valid statuses', async () => {
    healthyTenant();

    const report = await diagnose();

    expect(report.steps.map((step) => step.id)).toEqual([
      'addon_entitlement',
      'integration_status',
      'capabilities',
      'microsoft_profile',
      'recording_permissions',
      'package_metadata',
      'bot_connector',
      'bot_id_consistency',
      'artifact_subscriptions',
      'webhook_reachability',
      'user_linkage',
      'conversation_reference',
      'recent_delivery_health',
    ]);
    expect(report.steps.every((step) => ['pass', 'warn', 'fail', 'skip'].includes(step.status))).toBe(true);
  });

  it('fails the add-on check with a recommendation when the add-on is unavailable', async () => {
    healthyTenant();
    hoisted.state.hasAddon = false;

    const report = await diagnose();
    expect(report.steps.find((step) => step.id === 'addon_entitlement')).toMatchObject({
      status: 'fail',
      data: { reason: 'addon_required' },
    });
    expect(report.recommendations).toContain('Enable the Microsoft Teams add-on for this tenant.');
  });

  it('fails when no integration row exists and warns when it is not active', async () => {
    readyProfile();

    let report = await diagnose();
    expect(report.steps.find((step) => step.id === 'integration_status')).toMatchObject({
      status: 'fail',
    });

    resetTeamsState();
    activeIntegration();
    hoisted.state.integrations[0].install_status = 'install_pending';
    readyProfile();
    report = await diagnose();
    expect(report.steps.find((step) => step.id === 'integration_status')).toMatchObject({
      status: 'warn',
      data: { installStatus: 'install_pending' },
    });
  });

  it('warns and names missing required capabilities', async () => {
    activeIntegration(['personal_bot']);
    readyProfile();

    const report = await diagnose();
    expect(report.steps.find((step) => step.id === 'capabilities')).toMatchObject({
      status: 'warn',
      data: { missingCapabilities: ['activity_notifications'] },
    });
  });

  it('fails when the selected profile is missing, archived, or lacks a client secret', async () => {
    activeIntegration();
    let report = await diagnose();
    expect(report.steps.find((step) => step.id === 'microsoft_profile')).toMatchObject({
      status: 'fail',
      detail: 'Selected Microsoft profile was not found.',
    });

    resetTeamsState();
    activeIntegration();
    readyProfile({ is_archived: true });
    report = await diagnose();
    expect(report.steps.find((step) => step.id === 'microsoft_profile')).toMatchObject({
      status: 'fail',
      detail: 'Selected Microsoft profile is archived.',
    });

    resetTeamsState();
    activeIntegration();
    readyProfile({ client_secret_ref: null });
    report = await diagnose();
    expect(report.steps.find((step) => step.id === 'microsoft_profile')).toMatchObject({
      status: 'fail',
      detail: 'Selected Microsoft profile is missing a client secret reference.',
    });
  });

  it('T074/T075: warns when recording capture cannot use organizer object id and names required Microsoft permissions', async () => {
    activeIntegration();
    readyProfile();
    hoisted.state.integrations[0].default_meeting_organizer_object_id = null;

    const report = await diagnose();
    expect(report.steps.find((step) => step.id === 'recording_permissions')).toMatchObject({
      status: 'warn',
      data: {
        recordingsAvailable: false,
        reason: 'missing_organizer_object_id',
      },
    });

    hoisted.state.integrations[0].default_meeting_organizer_object_id = 'organizer-object-1';
    const readyReport = await diagnose();
    expect(readyReport.steps.find((step) => step.id === 'recording_permissions')).toMatchObject({
      status: 'pass',
      data: {
        recordingsAvailable: true,
        requiredGraphApplicationPermissions: [
          'Calendars.ReadWrite',
          'OnlineMeetingRecording.Read.All',
          'OnlineMeetingTranscript.Read.All',
        ],
        exchangeMailboxScopingRequired: true,
      },
    });
  });

  it('fails with no package metadata and warns for an invalid base URL', async () => {
    activeIntegration();
    readyProfile();
    hoisted.state.integrations[0].package_metadata = null;

    let report = await diagnose();
    expect(report.steps.find((step) => step.id === 'package_metadata')).toMatchObject({
      status: 'fail',
    });

    resetTeamsState();
    activeIntegration();
    readyProfile();
    hoisted.state.integrations[0].package_metadata = { baseUrl: 'not a url' };
    report = await diagnose();
    expect(report.steps.find((step) => step.id === 'package_metadata')).toMatchObject({
      status: 'warn',
    });
  });

  it('fails the bot connector check with env-var guidance when credentials are absent', async () => {
    healthyTenant();
    hoisted.state.isBotConfigured = false;

    const report = await diagnose();
    expect(report.steps.find((step) => step.id === 'bot_connector')).toMatchObject({
      status: 'fail',
    });
    expect(report.recommendations).toContain(
      'Configure TEAMS_BOT_APP_ID, TEAMS_BOT_APP_TENANT_ID, and TEAMS_BOT_APP_PASSWORD.'
    );
  });

  it('T013: fails the bot id consistency check with guidance when manifest bot id differs from TEAMS_BOT_APP_ID', async () => {
    healthyTenant();
    hoisted.state.botCredentials = { appId: 'platform-bot-app', tenantId: 'bot-tenant-1', password: 'bot-secret' };

    const report = await diagnose();
    const step = report.steps.find((entry) => entry.id === 'bot_id_consistency');
    expect(step).toMatchObject({
      status: 'fail',
      data: { manifestBotId: 'client-1', runtimeBotAppId: 'platform-bot-app' },
    });
    expect(step?.detail).toContain('TEAMS_BOT_APP_ID');
    expect(step?.detail).toContain('never reply');
    expect(report.recommendations).toContain(
      'Align the Bot Framework registration, TEAMS_BOT_APP_ID, and the generated manifest bot id (see the Teams setup runbook).'
    );
  });

  it('T014: passes bot id consistency when manifest and runtime ids match and skips without a generated package', async () => {
    healthyTenant();

    let report = await diagnose();
    expect(report.steps.find((entry) => entry.id === 'bot_id_consistency')).toMatchObject({
      status: 'pass',
      data: { manifestBotId: 'client-1' },
    });

    resetTeamsState();
    activeIntegration();
    readyProfile();
    hoisted.state.integrations[0].package_metadata = null;
    report = await diagnose();
    expect(report.steps.find((entry) => entry.id === 'bot_id_consistency')).toMatchObject({
      status: 'skip',
    });
  });

  it('T054: flags subscriptions expiring/expired and unreachable webhook base URL with remedies', async () => {
    healthyTenant();
    hoisted.state.integrations[0].recordings_subscription_expires_at = new Date(
      Date.now() - 60 * 60 * 1000
    ).toISOString();
    hoisted.state.integrations[0].transcripts_subscription_expires_at = new Date(
      Date.now() + 60 * 60 * 1000
    ).toISOString();
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));

    let report = await diagnose();
    const subscriptionStep = report.steps.find((step) => step.id === 'artifact_subscriptions');
    expect(subscriptionStep).toMatchObject({ status: 'warn' });
    expect(subscriptionStep?.detail).toContain('recordings subscription expired');
    expect(subscriptionStep?.detail).toContain('transcripts subscription is expiring');
    expect(report.recommendations).toContain(
      'Verify the renew-teams-meeting-artifact-subscriptions job is running.'
    );

    const webhookStep = report.steps.find((step) => step.id === 'webhook_reachability');
    expect(webhookStep).toMatchObject({
      status: 'warn',
      data: { webhookUrl: 'https://psa.example.com/api/teams/webhooks/recordings' },
    });
    expect(webhookStep?.detail).toContain('did not respond');
    expect(report.recommendations).toContain(
      'Confirm the recording webhook base URL is publicly reachable (DNS, TLS, and firewall) so Microsoft Graph can validate subscriptions.'
    );

    resetTeamsState();
    healthyTenant();
    hoisted.state.integrations[0].recordings_subscription_id = null;
    report = await diagnose();
    expect(report.steps.find((step) => step.id === 'artifact_subscriptions')).toMatchObject({
      status: 'fail',
      detail: 'Recording/transcript change-notification subscriptions have not been created.',
    });
  });

  it('T055: passes subscription checks when subscriptions are active and webhook URL is HTTPS-reachable', async () => {
    healthyTenant();

    const report = await diagnose();
    expect(report.steps.find((step) => step.id === 'artifact_subscriptions')).toMatchObject({
      status: 'pass',
      data: {
        recordingsExpiresAt: hoisted.state.integrations[0].recordings_subscription_expires_at,
        transcriptsExpiresAt: hoisted.state.integrations[0].transcripts_subscription_expires_at,
      },
    });
    expect(report.steps.find((step) => step.id === 'webhook_reachability')).toMatchObject({
      status: 'pass',
      data: {
        webhookUrl: 'https://psa.example.com/api/teams/webhooks/recordings',
        status: 405,
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://psa.example.com/api/teams/webhooks/recordings',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('warns when the admin has no Microsoft link', async () => {
    activeIntegration();
    readyProfile();

    const report = await diagnose();
    expect(report.steps.find((step) => step.id === 'user_linkage')).toMatchObject({
      status: 'warn',
    });
    expect(report.recommendations).toContain('Link your Microsoft account in your profile settings.');
  });

  it('warns when the admin has no conversation reference', async () => {
    activeIntegration();
    readyProfile();
    microsoftLink();

    const report = await diagnose();
    expect(report.steps.find((step) => step.id === 'conversation_reference')).toMatchObject({
      status: 'warn',
      detail: 'Open the Alga PSA bot in Teams and send it any message first, then retry.',
    });
  });

  it('reports recent success/failure and warns when the most recent attempt failed', async () => {
    healthyTenant();
    delivery({
      delivery_id: 'delivery-failure',
      status: 'failed',
      error_code: 'transient',
      error_message: 'network timeout',
      created_at: '2026-05-24T10:05:00.000Z',
    });

    const report = await diagnose();
    expect(report.steps.find((step) => step.id === 'recent_delivery_health')).toMatchObject({
      status: 'warn',
      data: {
        lastSuccess: expect.objectContaining({ deliveryId: 'delivery-success' }),
        lastFailure: expect.objectContaining({
          deliveryId: 'delivery-failure',
          errorMessage: 'network timeout',
        }),
      },
    });
  });

  it('reads recent deliveries only for the current tenant', async () => {
    healthyTenant();
    hoisted.state.deliveries.length = 0;
    delivery({
      tenant: '33333333-3333-3333-3333-333333333333',
      delivery_id: 'wrong-tenant-failure',
      status: 'failed',
      created_at: '2026-05-24T10:05:00.000Z',
    });

    const report = await diagnose();
    expect(report.steps.find((step) => step.id === 'recent_delivery_health')).toMatchObject({
      status: 'pass',
      data: {
        lastSuccess: null,
        lastFailure: null,
      },
    });
  });

  it('aggregates overall status by fail, warn, then pass', async () => {
    healthyTenant();
    await expect(diagnose()).resolves.toMatchObject({ overallStatus: 'pass' });

    resetTeamsState();
    activeIntegration();
    readyProfile();
    await expect(diagnose()).resolves.toMatchObject({ overallStatus: 'warn' });

    resetTeamsState();
    activeIntegration();
    hoisted.state.isBotConfigured = false;
    await expect(diagnose()).resolves.toMatchObject({ overallStatus: 'fail' });
  });

  it('deduplicates recommendations across checks', async () => {
    activeIntegration();
    readyProfile();

    const report = await diagnose();
    const linkRecommendations = report.recommendations.filter(
      (recommendation) => recommendation === 'Link your Microsoft account in your profile settings.'
    );
    expect(linkRecommendations).toHaveLength(1);
  });

  it('returns pass and no recommendations for a fully healthy tenant', async () => {
    healthyTenant();

    const report = await diagnose();
    expect(report.overallStatus).toBe('pass');
    expect(report.recommendations).toEqual([]);
  });
});
