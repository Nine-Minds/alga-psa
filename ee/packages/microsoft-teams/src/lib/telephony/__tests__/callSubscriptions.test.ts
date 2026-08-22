import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Subscription lifecycle for `communications/callRecords`. Without a live
 * subscription no call is ever journaled, and a subscription silently expires
 * after 60h — so create, renew and the 404-recreate path all get held to the
 * stored state they leave behind.
 */
const hoisted = vi.hoisted(() => {
  const providers: any[] = [];

  const createQuery = () => {
    const predicates: Array<(row: any) => boolean> = [];
    const filtered = () => providers.filter((row) => predicates.every((fn) => fn(row)));
    const query: any = {
      where(conditions: Record<string, unknown>) {
        predicates.push((row) => Object.entries(conditions)
          .every(([key, value]) => row[key.split('.').pop()!] === value));
        return query;
      },
      async first() {
        const [row] = filtered();
        return row ? { ...row } : undefined;
      },
      async update(values: Record<string, unknown>) {
        const rows = filtered();
        rows.forEach((row) => Object.assign(row, values));
        return rows.length;
      },
    };
    return query;
  };

  const knexMock: any = () => createQuery();
  knexMock.fn = { now: () => 'now()' };

  return {
    providers,
    knexMock,
    graphConfig: {
      value: {
        microsoftTenantId: 'contoso.onmicrosoft.com',
        clientId: 'client-id',
        clientSecret: 'client-secret',
      } as Record<string, string> | null,
    },
  };
});

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: hoisted.knexMock }),
  tenantDb: (conn: any, tenant: string) => ({
    table: () => conn().where({ tenant }),
  }),
}));

vi.mock('../../graphAuth', () => ({
  fetchMicrosoftGraphAppToken: vi.fn(async () => 'app-token'),
}));

vi.mock('../../meetings/meetingConfig', () => ({
  resolveTeamsMeetingGraphConfig: vi.fn(async () => hoisted.graphConfig.value),
}));

import {
  buildTelephonyClientState,
  extractCallRecordIdFromResource,
  parseTelephonyClientState,
  renewTelephonyCallSubscriptions,
  resolveCallRecordIdFromNotification,
  TEAMS_CALL_RECORDS_RESOURCE,
} from '../callSubscriptions';

const TENANT = 'tenant-1';
const HOUR = 60 * 60 * 1000;

function seedProvider(overrides: Record<string, unknown> = {}) {
  const row = {
    tenant: TENANT,
    provider_id: 'provider-1',
    provider: 'teams-phone',
    status: 'active',
    subscription_id: null,
    subscription_expires_at: null,
    webhook_secret: null,
    last_error: null,
    ...overrides,
  };
  hoisted.providers.push(row);
  return row;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('renewTelephonyCallSubscriptions', () => {
  const previousMode = process.env.TEAMS_EMULATOR_MODE;
  const previousBaseUrl = process.env.MICROSOFT_GRAPH_BASE_URL;
  const previousWebhookUrl = process.env.TELEPHONY_CALLS_WEBHOOK_URL;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    hoisted.providers.length = 0;
    hoisted.graphConfig.value = {
      microsoftTenantId: 'contoso.onmicrosoft.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    };
    process.env.TEAMS_EMULATOR_MODE = 'true';
    process.env.MICROSOFT_GRAPH_BASE_URL = 'http://localhost:4010/v1.0';
    process.env.TELEPHONY_CALLS_WEBHOOK_URL = 'http://localhost:3000/api/telephony/webhooks/teams-calls';
    fetchMock = vi.fn(async () => jsonResponse({
      id: 'graph-subscription-1',
      expirationDateTime: new Date(Date.now() + 60 * HOUR).toISOString(),
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.TEAMS_EMULATOR_MODE = previousMode;
    process.env.MICROSOFT_GRAPH_BASE_URL = previousBaseUrl;
    process.env.TELEPHONY_CALLS_WEBHOOK_URL = previousWebhookUrl;
  });

  it('T032: creating a subscription stores its id, expiry and clientState secret', async () => {
    const row = seedProvider();

    const [result] = await renewTelephonyCallSubscriptions({ tenantId: TENANT });

    expect(result).toMatchObject({ provider: 'teams-phone', subscriptionId: 'graph-subscription-1', action: 'created' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:4010/v1.0/subscriptions');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      resource: TEAMS_CALL_RECORDS_RESOURCE,
      changeType: 'created,updated',
      notificationUrl: 'http://localhost:3000/api/telephony/webhooks/teams-calls',
    });

    // The secret minted for this tenant is what the webhook later verifies.
    expect(row.webhook_secret).toMatch(/^[0-9a-f]{64}$/);
    expect(body.clientState).toBe(buildTelephonyClientState(TENANT, row.webhook_secret as string));
    expect(row.subscription_id).toBe('graph-subscription-1');
    expect(row.subscription_expires_at).toBeTruthy();
    expect(row.last_error).toBeNull();
  });

  it('T033: a subscription near expiry is renewed in place', async () => {
    const row = seedProvider({
      subscription_id: 'graph-subscription-1',
      subscription_expires_at: new Date(Date.now() + HOUR).toISOString(),
      webhook_secret: 'existing-secret',
    });

    const [result] = await renewTelephonyCallSubscriptions({ tenantId: TENANT });

    expect(result).toMatchObject({ subscriptionId: 'graph-subscription-1', action: 'renewed' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PATCH');
    expect(url).toBe('http://localhost:4010/v1.0/subscriptions/graph-subscription-1');
    expect(row.webhook_secret).toBe('existing-secret');
  });

  it('T033: a subscription with plenty of life left is left alone', async () => {
    seedProvider({
      subscription_id: 'graph-subscription-1',
      subscription_expires_at: new Date(Date.now() + 40 * HOUR).toISOString(),
      webhook_secret: 'existing-secret',
    });

    await expect(renewTelephonyCallSubscriptions({ tenantId: TENANT })).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('T033: a subscription Graph has forgotten (404) is recreated', async () => {
    const row = seedProvider({
      subscription_id: 'stale-subscription',
      subscription_expires_at: new Date(Date.now() + HOUR).toISOString(),
      webhook_secret: 'existing-secret',
    });
    fetchMock.mockResolvedValueOnce(new Response('gone', { status: 404 }));

    const [result] = await renewTelephonyCallSubscriptions({ tenantId: TENANT });

    expect(result).toMatchObject({ subscriptionId: 'graph-subscription-1', action: 'created' });
    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:4010/v1.0/subscriptions');
    expect(row.subscription_id).toBe('graph-subscription-1');
  });

  it('T033: a failed renewal is recorded on the provider and rethrown', async () => {
    const row = seedProvider({
      subscription_id: 'graph-subscription-1',
      subscription_expires_at: new Date(Date.now() + HOUR).toISOString(),
      webhook_secret: 'existing-secret',
    });
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));

    await expect(renewTelephonyCallSubscriptions({ tenantId: TENANT })).rejects.toThrow(/Failed to renew/);
    expect(row.last_error).toMatch(/Failed to renew/);
    expect(row.subscription_id).toBe('graph-subscription-1');
  });

  it('T033: a provider that is not active never subscribes', async () => {
    seedProvider({ status: 'disabled' });

    await expect(renewTelephonyCallSubscriptions({ tenantId: TENANT })).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('T033: a tenant without Teams configured never subscribes', async () => {
    seedProvider();
    hoisted.graphConfig.value = null;

    await expect(renewTelephonyCallSubscriptions({ tenantId: TENANT })).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('telephony clientState and notification parsing', () => {
  it('round-trips the tenant and secret through clientState', () => {
    const clientState = buildTelephonyClientState('tenant-1', 'abc123');

    expect(parseTelephonyClientState(clientState)).toEqual({
      tenantId: 'tenant-1',
      provider: 'teams-phone',
      secret: 'abc123',
    });
    expect(parseTelephonyClientState('teams-artifacts:tenant-1:secret')).toBeNull();
    expect(parseTelephonyClientState(undefined)).toBeNull();
  });

  it('extracts the call record id from both resource shapes Graph sends', () => {
    expect(extractCallRecordIdFromResource("communications/callRecords('call-1')")).toBe('call-1');
    expect(extractCallRecordIdFromResource('communications/callRecords/call-2')).toBe('call-2');
    expect(extractCallRecordIdFromResource(null)).toBeNull();

    expect(resolveCallRecordIdFromNotification({
      resourceData: { '@odata.id': "communications/callRecords('call-3')" },
    })).toBe('call-3');
    expect(resolveCallRecordIdFromNotification({ resourceData: { id: 'call-4' } })).toBe('call-4');
    expect(resolveCallRecordIdFromNotification({})).toBeNull();
  });
});
