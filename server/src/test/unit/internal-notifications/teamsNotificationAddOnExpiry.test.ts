import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const ACTIVE_INTEGRATION = {
    selected_profile_id: 'profile-1',
    install_status: 'active',
    enabled_capabilities: ['activity_notifications'],
    notification_categories: ['assignment'],
    app_id: 'teams-app-1',
    package_metadata: { baseUrl: 'https://psa.example.com' },
  } as const;

  const state = {
    // null → absent; { expires_at } → present with the given expiry.
    addOn: { expires_at: null as string | null } as { expires_at: string | null } | null,
    integration: { ...ACTIVE_INTEGRATION } as Record<string, unknown> | null,
    profile: {
      profile_id: 'profile-1',
      client_id: 'client-1',
      tenant_id: 'aad-tenant-1',
      client_secret_ref: 'secret-ref',
      is_archived: false,
    } as Record<string, unknown> | null,
    accountLinks: [{ provider: 'microsoft', provider_account_id: 'aad-user-1' }] as Array<Record<string, string>>,
    deliveryRows: [] as Array<Record<string, unknown>>,
    integrationReads: 0,
  };

  function addOnIsActive(): boolean {
    if (!state.addOn) {
      return false;
    }
    const { expires_at } = state.addOn;
    return expires_at == null || new Date(expires_at).getTime() > Date.now();
  }

  function query(table: string) {
    return {
      where() {
        return this;
      },
      andWhere(cb?: (b: any) => void) {
        if (cb) {
          cb({
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
          // Mirrors the SQL predicate "expires_at IS NULL OR expires_at > now()".
          return addOnIsActive() ? { addon_key: 'teams' } : undefined;
        }
        if (table === 'teams_integrations') {
          state.integrationReads += 1;
          return state.integration ?? undefined;
        }
        if (table === 'microsoft_profiles') {
          return state.profile ?? undefined;
        }
        throw new Error(`Unexpected table: ${table}`);
      },
      // The delivery path must never mutate/delete teams_integrations; blow up if it tries.
      async update() {
        throw new Error(`Unexpected update on ${table}`);
      },
      async del() {
        throw new Error(`Unexpected delete on ${table}`);
      },
      async delete() {
        throw new Error(`Unexpected delete on ${table}`);
      },
    };
  }

  const knex = Object.assign((table: string) => query(table), {
    fn: {
      now: vi.fn(() => new Date()),
    },
  });

  return {
    state,
    ACTIVE_INTEGRATION,
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

function graphResponse(status: number, body = '', requestId = 'request-1') {
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

const past = () => new Date(Date.now() - 86_400_000).toISOString();

describe('deliverTeamsNotificationImpl add-on expiry soft-disable (F065)', () => {
  beforeEach(() => {
    hoisted.state.addOn = { expires_at: null };
    hoisted.state.integration = { ...hoisted.ACTIVE_INTEGRATION };
    hoisted.state.accountLinks = [{ provider: 'microsoft', provider_account_id: 'aad-user-1' }];
    hoisted.state.deliveryRows.length = 0;
    hoisted.state.integrationReads = 0;
    hoisted.writeTeamsDeliveryRowMock.mockClear();
    hoisted.fetchMicrosoftGraphAppTokenMock.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => graphResponse(200, '', 'request-200')));
  });

  it('T106: an expired add-on row skips delivery with addon_inactive and writes that skipped row', async () => {
    hoisted.state.addOn = { expires_at: past() };

    const result = await deliverTeamsNotificationImpl(notification());

    expect(result).toEqual({ status: 'skipped', reason: 'addon_inactive' });
    expect(hoisted.state.deliveryRows).toHaveLength(1);
    expect(hoisted.state.deliveryRows[0]).toMatchObject({
      status: 'skipped',
      errorCode: 'addon_inactive',
      retryable: false,
    });
  });

  it('T106: the expired-add-on skip preserves teams_integrations config (never read, mutated, or deleted)', async () => {
    hoisted.state.addOn = { expires_at: past() };
    const configBefore = JSON.parse(JSON.stringify(hoisted.state.integration));

    await deliverTeamsNotificationImpl(notification());

    // The gate short-circuits before the integration row is ever touched; the
    // query builder throws on any update/delete, so the config survives untouched.
    expect(hoisted.state.integrationReads).toBe(0);
    expect(hoisted.state.integration).toEqual(configBefore);
  });

  it('T107: re-activating the add-on restores full delivery without reconfiguration', async () => {
    // Lapse first: skipped/addon_inactive with config intact.
    hoisted.state.addOn = { expires_at: past() };
    const skipped = await deliverTeamsNotificationImpl(notification());
    expect(skipped).toEqual({ status: 'skipped', reason: 'addon_inactive' });

    // Re-activate with a fresh non-expired row; the same untouched config now delivers.
    hoisted.state.addOn = { expires_at: null };
    hoisted.state.deliveryRows.length = 0;

    const delivered = await deliverTeamsNotificationImpl(notification());

    expect(delivered.status).toBe('delivered');
    expect(hoisted.state.deliveryRows).toHaveLength(1);
    expect(hoisted.state.deliveryRows[0]).toMatchObject({ status: 'delivered' });
  });
});
