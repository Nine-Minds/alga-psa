import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = {
    addonActive: true,
    integration: {
      selected_profile_id: 'profile-1',
      install_status: 'active',
      enabled_capabilities: ['activity_notifications'],
      notification_categories: ['assignment'],
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
      now: vi.fn(() => new Date('2026-05-24T10:00:00.000Z')),
    },
  });

  return {
    state,
    createTenantKnexMock: vi.fn(async () => ({ knex, tenant: '22222222-2222-2222-2222-222222222222' })),
    writeTeamsDeliveryRowMock: vi.fn(async (row: Record<string, unknown>) => {
      state.deliveryRows.push(row);
      return { inserted: true, idempotencyKey: 'key-1', deliveryId: 'delivery-1' };
    }),
    fetchMicrosoftGraphAppTokenMock: vi.fn(async () => 'graph-token'),
    publishWorkflowEventMock: vi.fn(async () => undefined),
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

function graphResponse(status: number, body = 'graph body', requestId = 'request-1') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    headers: {
      get: (name: string) => (name === 'request-id' ? requestId : null),
    },
    text: vi.fn(async () => body),
  } as unknown as Response;
}

describe('deliverTeamsNotificationImpl observability rows', () => {
  beforeEach(() => {
    hoisted.state.addonActive = true;
    hoisted.state.integration = {
      selected_profile_id: 'profile-1',
      install_status: 'active',
      enabled_capabilities: ['activity_notifications'],
      notification_categories: ['assignment'],
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
    hoisted.state.deliveryRows.length = 0;
    hoisted.writeTeamsDeliveryRowMock.mockClear();
    hoisted.fetchMicrosoftGraphAppTokenMock.mockClear();
    hoisted.publishWorkflowEventMock.mockClear();
    hoisted.warnMock.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => graphResponse(200, '', 'request-200')));
  });

  it.each([
    ['addon_inactive', () => { hoisted.state.addonActive = false; }, 'addon_inactive'],
    ['integration_inactive', () => { hoisted.state.integration = { ...hoisted.state.integration, install_status: 'error' }; }, 'integration_inactive'],
    ['user_not_mapped', () => { hoisted.state.accountLinks = []; }, 'user_not_mapped'],
    ['package_misconfigured', () => { hoisted.state.integration = { ...hoisted.state.integration, package_metadata: {} }; }, 'package_misconfigured'],
  ])('writes skipped row for %s', async (_name, arrange, errorCode) => {
    arrange();

    const result = await deliverTeamsNotificationImpl(notification());

    expect(result.status).toBe('skipped');
    expect(hoisted.state.deliveryRows).toHaveLength(1);
    expect(hoisted.state.deliveryRows[0]).toMatchObject({
      status: 'skipped',
      errorCode,
      retryable: false,
    });
  });

  it('writes delivered row with provider message and request ids on Graph success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => graphResponse(200, '', 'request-delivered')));

    const result = await deliverTeamsNotificationImpl(notification());

    expect(result).toMatchObject({
      status: 'delivered',
      providerMessageId: 'request-delivered',
    });
    expect(hoisted.state.deliveryRows[0]).toMatchObject({
      status: 'delivered',
      providerMessageId: 'request-delivered',
      providerRequestId: 'request-delivered',
      destinationId: 'aad-user-1',
      errorCode: null,
    });
  });

  it.each([
    [429, 'graph_throttled', true, 3],
    [401, 'graph_unauthorized', false, 1],
    [403, 'graph_unauthorized', false, 1],
    [404, 'graph_not_found', false, 1],
    [500, 'graph_server_error', true, 3],
  ])('writes failed row for Graph %s', async (status, errorCode, retryable, expectedAttempts) => {
    const fetchMock = vi.fn(async () => graphResponse(status, 'failure body', `request-${status}`));
    vi.stubGlobal('fetch', fetchMock);

    const result = await deliverTeamsNotificationImpl(notification(), { retry: { baseDelayMs: 0 } });

    expect(result.status).toBe('failed');
    // T021/T022: retryable statuses get bounded retries; non-retryable 4xx get one attempt.
    expect(fetchMock).toHaveBeenCalledTimes(expectedAttempts);
    expect(hoisted.state.deliveryRows).toHaveLength(1);
    expect(hoisted.state.deliveryRows[0]).toMatchObject({
      status: 'failed',
      errorCode,
      retryable,
      providerRequestId: `request-${status}`,
    });
  });

  it('T020: retries 429 honouring Retry-After and records only the final delivered row', async () => {
    const throttled = {
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'retry-after' ? '0' : name === 'request-id' ? 'request-429' : null,
      },
      text: vi.fn(async () => 'throttled'),
    } as unknown as Response;

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(throttled)
      .mockResolvedValueOnce(throttled)
      .mockResolvedValueOnce(graphResponse(200, '', 'request-final'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await deliverTeamsNotificationImpl(notification());

    expect(result).toMatchObject({ status: 'delivered', providerMessageId: 'request-final' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(hoisted.state.deliveryRows).toHaveLength(1);
    expect(hoisted.state.deliveryRows[0]).toMatchObject({
      status: 'delivered',
      providerMessageId: 'request-final',
    });
  });

  it('T021: bounded retries stop after maxAttempts and record failed with retryable=true', async () => {
    const fetchMock = vi.fn(async () => graphResponse(503, 'server busy', 'request-503'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await deliverTeamsNotificationImpl(notification(), {
      retry: { maxAttempts: 2, baseDelayMs: 0 },
    });

    expect(result).toMatchObject({ status: 'failed', retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hoisted.state.deliveryRows).toHaveLength(1);
    expect(hoisted.state.deliveryRows[0]).toMatchObject({
      status: 'failed',
      errorCode: 'graph_server_error',
      retryable: true,
    });
  });

  it('writes transient retryable failure row when Graph fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network timeout');
    }));

    const result = await deliverTeamsNotificationImpl(notification());

    expect(result.status).toBe('failed');
    expect(hoisted.state.deliveryRows[0]).toMatchObject({
      status: 'failed',
      errorCode: 'transient',
      errorMessage: 'network timeout',
      retryable: true,
    });
  });
});
