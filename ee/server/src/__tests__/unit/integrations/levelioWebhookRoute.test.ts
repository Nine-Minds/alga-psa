/**
 * EE Level.io webhook route tests (fully mocked, no DB).
 *
 * Locks the handler contract that middleware now lets through:
 *   - tenant-scoped X-Alga-Webhook-Secret validation happens in-route, before
 *     any processing, with zero side effects on rejection;
 *   - the org backfill precedence is wired into the normalized event that the
 *     shared RMM pipeline receives (explicit group_id → device mapping realm →
 *     bounded Level hierarchy lookup → null).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const dbRows: Record<string, any[]> = {};
  const client: { getDevice?: any; listGroups?: any } = {};
  const processRmmAlertEvent = vi.fn(async () => ({ outcome: 'ticket_created' as const }));
  const publishEvent = vi.fn(async () => undefined);
  const secrets = {
    'tenant-a': 'secret-a',
    'tenant-b': 'secret-b',
  };
  const getDeviceImpl = vi.fn(async () => ({ id: 'dev-1', hostname: 'WS-01', group_id: 'g-sub' }));
  const listGroupsImpl = vi.fn(async () => [
    { id: 'g-root', parent_id: null, name: 'Acme Corp' },
    { id: 'g-sub', parent_id: 'g-root', name: 'Branch' },
  ]);
  return { dbRows, client, processRmmAlertEvent, publishEvent, secrets, getDeviceImpl, listGroupsImpl };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  isTenantSuspended: async () => false,
  tenantDb: (_knex: unknown, _tenant: string) => ({
    table: (table: string) => {
      const rows = h.dbRows[table] ?? [];
      const builder: any = {
        where: () => builder,
        whereNotNull: () => builder,
        andWhere: () => builder,
        first: async () => rows[0],
        select: async () => rows,
      };
      return builder;
    },
  }),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: async (tenant: string) => h.secrets[tenant as keyof typeof h.secrets],
  }),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: h.publishEvent,
}));

vi.mock('@alga-psa/shared/rmm/alerts', () => ({
  processRmmAlertEvent: h.processRmmAlertEvent,
}));

vi.mock('@alga-psa/integrations/lib/rmm/alerts/pipelineDeps', () => ({
  buildRmmAlertPipelineDeps: () => ({}),
}));

vi.mock('@ee/lib/integrations/levelio/levelApiClient', () => ({
  LEVELIO_WEBHOOK_SECRET_KEY: 'levelio_webhook_secret',
  createLevelIoClient: async () => ({
    getDevice: h.client.getDevice ?? h.getDeviceImpl,
    listGroups: h.client.listGroups ?? h.listGroupsImpl,
  }),
}));

vi.mock('@ee/lib/integrations/levelio/sync/transport', () => ({
  levelIoTransportOverride: () => 'temporal',
  startLevelIoDeviceSyncWorkflow: vi.fn(async () => null),
}));

vi.mock('@ee/lib/integrations/levelio/sync/syncEngine', () => ({
  runLevelIoDeviceSync: vi.fn(async () => ({ externalDeviceId: 'dev-1', action: 'skipped' })),
}));

import { POST } from '../../../app/api/webhooks/levelio/route';

const WEBHOOK_URL = 'http://localhost/api/webhooks/levelio';

function payload(overrides: Record<string, unknown> = {}) {
  return {
    event: 'alert.triggered',
    alert_id: 'al-1',
    device_id: 'dev-1',
    hostname: 'WS-01',
    name: 'CPU',
    severity: 'critical',
    description: 'cpu usage above threshold',
    ...overrides,
  };
}

function request(tenant: string, secret: string | null, body: unknown): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) headers['x-alga-webhook-secret'] = secret;
  return new Request(`${WEBHOOK_URL}?tenant=${tenant}`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function processCall() {
  return h.processRmmAlertEvent.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  h.dbRows['rmm_integrations'] = [{ integration_id: 'int-1' }];
  h.dbRows['tenant_external_entity_mappings'] = [
    { alga_entity_id: 'asset-1', external_realm_id: 'g-1' },
  ];
  h.dbRows['rmm_organization_mappings'] = [];
  h.processRmmAlertEvent.mockClear();
  h.publishEvent.mockClear();
  h.getDeviceImpl.mockClear();
  h.listGroupsImpl.mockClear();
  h.client.getDevice = undefined;
  h.client.listGroups = undefined;
});

afterEach(() => {
  for (const key of Object.keys(h.dbRows)) delete h.dbRows[key];
});

describe('Level.io webhook route auth (tenant-scoped shared secret)', () => {
  it('missing tenant → 400 Missing tenant with zero side effects', async () => {
    const res = await POST(request('', 'secret-a', payload()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Missing tenant' });
    expect(h.processRmmAlertEvent).not.toHaveBeenCalled();
    expect(h.publishEvent).not.toHaveBeenCalled();
  });

  it('missing secret → 401 with zero side effects', async () => {
    const res = await POST(request('tenant-a', null, payload()));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized: missing webhook secret' });
    expect(h.processRmmAlertEvent).not.toHaveBeenCalled();
  });

  it('wrong secret for the tenant → 401 invalid webhook secret', async () => {
    const res = await POST(request('tenant-a', 'not-the-secret', payload()));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized: invalid webhook secret' });
    expect(h.processRmmAlertEvent).not.toHaveBeenCalled();
  });

  it('tenant-secret isolation: tenant A secret does not authorize tenant B', async () => {
    const res = await POST(request('tenant-b', 'secret-a', payload()));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized: invalid webhook secret' });
    expect(h.processRmmAlertEvent).not.toHaveBeenCalled();
  });

  it('invalid JSON → 400 with zero side effects', async () => {
    const res = await POST(request('tenant-a', 'secret-a', '{not json'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
    expect(h.processRmmAlertEvent).not.toHaveBeenCalled();
  });

  it('missing device_id → 400 with zero side effects', async () => {
    const res = await POST(request('tenant-a', 'secret-a', { ...payload(), device_id: '' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'device_id is required' });
    expect(h.processRmmAlertEvent).not.toHaveBeenCalled();
  });
});

describe('Level.io webhook route org resolution wiring', () => {
  it('backfills externalOrganizationId from the device mapping realm (no group_id in payload)', async () => {
    const res = await POST(request('tenant-a', 'secret-a', payload()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, recorded: true, outcome: 'ticket_created' });

    const normalized = await processCall();
    expect(normalized).toMatchObject({
      tenantId: 'tenant-a',
      integrationId: 'int-1',
      provider: 'levelio',
      kind: 'triggered',
      externalAlertId: 'al-1',
      externalDeviceId: 'dev-1',
      conditionIdentity: 'CPU',
      severity: 'major', // Level 'critical' → normalized major
      message: 'CPU: cpu usage above threshold',
      deviceName: 'WS-01',
      externalOrganizationId: 'g-1',
    });
    expect(h.publishEvent).toHaveBeenCalled();
  });

  it('an explicit body.group_id overrides the device mapping realm', async () => {
    const res = await POST(
      request('tenant-a', 'secret-a', payload({ group_id: 'g-2' }))
    );
    expect(res.status).toBe(200);
    const normalized = await processCall();
    expect((normalized as any).externalOrganizationId).toBe('g-2');
  });

  it('falls back to a bounded Level hierarchy lookup for an unmapped device', async () => {
    h.dbRows['tenant_external_entity_mappings'] = [];
    h.dbRows['rmm_organization_mappings'] = [{ external_organization_id: 'g-root' }];

    const res = await POST(request('tenant-a', 'secret-a', payload()));
    expect(res.status).toBe(200);
    const normalized = await processCall();
    expect((normalized as any).externalOrganizationId).toBe('g-root');
    expect(h.getDeviceImpl).toHaveBeenCalledWith('dev-1');
    expect(h.listGroupsImpl).toHaveBeenCalled();
  });

  it('a failed Level lookup leaves the org null and still records the alert', async () => {
    h.dbRows['tenant_external_entity_mappings'] = [];
    h.client.getDevice = vi.fn(async () => {
      throw new Error('Level API request failed with status 500');
    });

    const res = await POST(request('tenant-a', 'secret-a', payload()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, recorded: true });
    const normalized = await processCall();
    expect((normalized as any).externalOrganizationId).toBeNull();
  });
});
