/**
 * EE Level.io webhook route tests (fully mocked, no DB).
 *
 * Locks the handler contract that middleware now lets through:
 *   - tenant-scoped X-Alga-Webhook-Secret (automation) and X-Level-Signature
 *     (native, HMAC over the raw body) validation happens in-route, before any
 *     processing, with zero side effects on rejection;
 *   - native envelopes map to triggered/reset, redeliveries of an event_id are
 *     no-ops, other event types are acknowledged;
 *   - unrendered {{...}} automation values are treated as absent;
 *   - the org backfill precedence is wired into the normalized event that the
 *     shared RMM pipeline receives (explicit group_id → device mapping realm →
 *     bounded Level hierarchy lookup → null).
 */

import { createHmac } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const dbRows: Record<string, any[]> = {};
  const client: { getDevice?: any; listGroups?: any } = {};
  const processRmmAlertEvent = vi.fn(async () => ({ outcome: 'ticket_created' as const }));
  const publishEvent = vi.fn(async () => undefined);
  const secrets = {
    'tenant-a': 'secret-a',
    'tenant-b': 'secret-b',
    // Connected before native support: no signing secret generated yet.
    'tenant-legacy': 'secret-legacy',
  };
  const signingSecrets = {
    'tenant-a': 'sign-a',
    'tenant-b': 'sign-b',
  };
  const claimedEvents = new Set<string>();
  const getDeviceImpl = vi.fn(async () => ({ id: 'dev-1', hostname: 'WS-01', group_id: 'g-sub' }));
  const listGroupsImpl = vi.fn(async () => [
    { id: 'g-root', parent_id: null, name: 'Acme Corp' },
    { id: 'g-sub', parent_id: 'g-root', name: 'Branch' },
  ]);
  return { dbRows, client, processRmmAlertEvent, publishEvent, secrets, signingSecrets, claimedEvents, getDeviceImpl, listGroupsImpl };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  isTenantSuspended: async () => false,
  tenantDb: (_knex: unknown, _tenant: string) => ({
    table: (table: string) => {
      const rows = h.dbRows[table] ?? [];
      if (table === 'rmm_webhook_events') {
        let pending: any = null;
        const events: any = {
          insert: (row: any) => { pending = row; return events; },
          onConflict: () => events,
          ignore: () => events,
          returning: async () => {
            if (h.claimedEvents.has(pending.event_id)) return [];
            h.claimedEvents.add(pending.event_id);
            return [{ event_id: pending.event_id }];
          },
          where: () => events,
          del: async () => { h.claimedEvents.clear(); return 1; },
        };
        return events;
      }
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
    getTenantSecret: async (tenant: string, name: string) =>
      (name === 'levelio_webhook_signing_secret' ? h.signingSecrets : h.secrets)[tenant as keyof typeof h.secrets],
  }),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: h.publishEvent,
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/shared/rmm/alerts', () => ({
  processRmmAlertEvent: h.processRmmAlertEvent,
}));

vi.mock('@alga-psa/integrations/lib/rmm/alerts/pipelineDeps', () => ({
  buildRmmAlertPipelineDeps: () => ({}),
}));

vi.mock('@ee/lib/integrations/levelio/levelApiClient', () => ({
  LEVELIO_WEBHOOK_SECRET_KEY: 'levelio_webhook_secret',
  LEVELIO_WEBHOOK_SIGNING_SECRET_KEY: 'levelio_webhook_signing_secret',
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
import {
  LEVELIO_AUTOMATION_DESCRIPTION_PLACEHOLDER,
  LEVELIO_AUTOMATION_NAME_PLACEHOLDER,
} from '../../../lib/integrations/levelio/webhookPayload';

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
  h.claimedEvents.clear();
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
    expect(await res.json()).toEqual({ error: expect.stringContaining('device_id is required') });
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
    h.dbRows['rmm_organization_mappings'] = [{ external_organization_id: 'g-2' }];
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

describe('Level.io automation path: placeholders and identity', () => {
  it('a literal {{...}} device_id is treated as absent → 400, nothing recorded', async () => {
    const res = await POST(request('tenant-a', 'secret-a', payload({ device_id: '{{device_id}}' })));
    expect(res.status).toBe(400);
    expect(h.processRmmAlertEvent).not.toHaveBeenCalled();
  });

  it('the old pasted template no longer collapses: placeholder alert_id/name are never used', async () => {
    const oldTemplate = {
      event: 'alert.triggered',
      alert_id: '{{alert_id}}',
      device_id: '{{device_id}}',
      hostname: '{{hostname}}',
      name: '{{alert_name}}',
      severity: '{{severity}}',
      description: '{{description}}',
    };
    const res = await POST(request('tenant-a', 'secret-a', oldTemplate));
    expect(res.status).toBe(400);
    expect(h.processRmmAlertEvent).not.toHaveBeenCalled();

    // Rendered device but leftover placeholders elsewhere: placeholders dropped.
    const res2 = await POST(request('tenant-a', 'secret-a', { ...oldTemplate, device_id: 'dev-1' }));
    expect(res2.status).toBe(200);
    const normalized = (await processCall()) as any;
    expect(normalized.externalAlertId).not.toContain('{{');
    expect(normalized.externalAlertId).toBe('automation:dev-1:level alert');
    expect(normalized.alertClass).toBe('Level alert');
    expect(normalized.conditionIdentity).toBe('Level alert');
    expect(normalized.deviceName).toBeNull();
    expect(normalized.message).toBe('Level alert');
  });

  it('derives a deterministic id from device + name: distinct alerts differ, repeats match', async () => {
    const send = async (body: Record<string, unknown>) => {
      h.processRmmAlertEvent.mockClear();
      await POST(request('tenant-a', 'secret-a', body));
      return ((await processCall()) as any).externalAlertId as string;
    };
    const cpu1 = await send(payload({ alert_id: undefined, name: 'CPU' }));
    const cpu2 = await send(payload({ alert_id: undefined, name: ' cpu ' }));
    const mem = await send(payload({ alert_id: undefined, name: 'Memory' }));
    const otherDevice = await send(payload({ alert_id: undefined, name: 'CPU', device_id: 'dev-2' }));
    expect(cpu1).toBe(cpu2);
    expect(new Set([cpu1, mem, otherDevice]).size).toBe(3);
  });

  it('the unedited template name is replaced (with a warning) by the edited description, else a generic name', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const send = async (body: Record<string, unknown>) => {
      h.processRmmAlertEvent.mockClear();
      expect((await POST(request('tenant-a', 'secret-a', body))).status).toBe(200);
      return (await processCall()) as any;
    };
    const pristine = { name: LEVELIO_AUTOMATION_NAME_PLACEHOLDER, alert_id: undefined };
    const edited = await send(payload({ ...pristine, description: 'Disk almost full' }));
    expect(edited.externalAlertId).toBe('automation:dev-1:disk almost full');
    const bare = await send(payload({ ...pristine, description: LEVELIO_AUTOMATION_DESCRIPTION_PLACEHOLDER }));
    expect(bare.externalAlertId).toBe('automation:dev-1:level alert');
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('canonicalizes an explicit unmapped level_group_id to the deepest mapped ancestor', async () => {
    h.dbRows['rmm_organization_mappings'] = [{ external_organization_id: 'g-root' }];
    const res = await POST(request('tenant-a', 'secret-a', payload({ group_id: 'g-sub' })));
    expect(res.status).toBe(200);
    expect(((await processCall()) as any).externalOrganizationId).toBe('g-root');
  });

  it('a placeholder group_id is ignored and the device realm is used', async () => {
    const res = await POST(request('tenant-a', 'secret-a', payload({ group_id: '{{level_group_id}}' })));
    expect(res.status).toBe(200);
    expect(((await processCall()) as any).externalOrganizationId).toBe('g-1');
  });
});

describe('Level.io native webhook (X-Level-Signature)', () => {
  const envelope = (eventType: string, data: Record<string, unknown> = {}, eventId = 'evt-1') => ({
    event_type: eventType,
    event_id: eventId,
    occurred_at: '2026-10-15T10:00:00Z',
    data: {
      id: 'alert-9',
      device_id: 'dev-1',
      device_hostname: 'WS-01',
      name: 'CPU',
      description: 'CPU above 90%',
      payload: '95%',
      severity: 'critical',
      is_resolved: false,
      started_at: '2026-10-15T09:55:00Z',
      resolved_at: null,
      ...data,
    },
  });
  const sign = (raw: string, secret = 'sign-a') => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  const signed = (raw: string, signature: string | null, tenant = 'tenant-a') => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (signature !== null) headers['x-level-signature'] = signature;
    return new Request(`${WEBHOOK_URL}?tenant=${tenant}`, { method: 'POST', headers, body: raw });
  };

  it('missing, malformed, wrong-secret and wrong-tenant signatures → 401 with zero side effects', async () => {
    const raw = JSON.stringify(envelope('alert_active'));
    for (const header of [
      '',
      'sha256=abc',
      sign(raw, 'wrong'),
      sign(raw).replace('sha256=', ''),
      sign(raw, 'sign-b'),
      sign(raw, 'secret-b'),
    ]) {
      const res = await POST(signed(raw, header));
      expect(res.status).toBe(401);
    }
    // Native header present but tenant has no signing secret configured.
    expect((await POST(signed(raw, sign(raw), 'tenant-unknown'))).status).toBe(401);
    expect(h.processRmmAlertEvent).not.toHaveBeenCalled();
    expect(h.publishEvent).not.toHaveBeenCalled();
    expect(h.claimedEvents.size).toBe(0);
  });

  it('a signature keyed with the legacy shared webhook secret is accepted', async () => {
    // Setups made before the signing secret existed pasted the shared secret
    // into Level's signing field.
    const raw = JSON.stringify(envelope('alert_active'));
    const res = await POST(signed(raw, sign(raw, 'secret-a')));
    expect(res.status).toBe(200);
    expect(await processCall()).toMatchObject({ tenantId: 'tenant-a', externalAlertId: 'alert-9' });
  });

  it('a tenant with no signing secret yet still verifies against its legacy secret', async () => {
    const raw = JSON.stringify(envelope('alert_active'));
    const res = await POST(signed(raw, sign(raw, 'secret-legacy'), 'tenant-legacy'));
    expect(res.status).toBe(200);
    expect(await processCall()).toMatchObject({ tenantId: 'tenant-legacy' });
    // Another tenant's legacy secret never authorizes it.
    h.claimedEvents.clear();
    expect((await POST(signed(raw, sign(raw, 'secret-a'), 'tenant-legacy'))).status).toBe(401);
  });

  it('a Level delivery without X-Level-Signature and without the custom header → 401', async () => {
    const res = await POST(signed(JSON.stringify(envelope('alert_active')), null));
    expect(res.status).toBe(401);
  });

  it('the custom secret header cannot authorize a native-signed request', async () => {
    const raw = JSON.stringify(envelope('alert_active'));
    const req = new Request(`${WEBHOOK_URL}?tenant=tenant-a`, {
      method: 'POST',
      headers: { 'x-level-signature': 'sha256=' + '0'.repeat(64), 'x-alga-webhook-secret': 'secret-a' },
      body: raw,
    });
    expect((await POST(req)).status).toBe(401);
  });

  it('verifies over the raw bytes: whitespace and key order are preserved, reserialization breaks it', async () => {
    const compact = JSON.stringify(envelope('alert_active'));
    const pretty = JSON.stringify(envelope('alert_active'), null, 4);
    const reordered = JSON.stringify(
      Object.fromEntries(Object.entries(envelope('alert_active')).reverse()),
    ) + '\n';
    for (const raw of [compact, pretty, reordered]) {
      h.claimedEvents.clear();
      const res = await POST(signed(raw, sign(raw)));
      expect(res.status).toBe(200);
    }
    // A signature computed over a different serialization of the same JSON fails.
    const res = await POST(signed(pretty, sign(compact)));
    expect(res.status).toBe(401);
  });

  it('alert_active → triggered with documented fields mapped and payload kept raw', async () => {
    const raw = JSON.stringify(envelope('alert_active'));
    const res = await POST(signed(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, recorded: true });
    expect(await processCall()).toMatchObject({
      tenantId: 'tenant-a',
      kind: 'triggered',
      externalAlertId: 'alert-9',
      externalDeviceId: 'dev-1',
      deviceName: 'WS-01',
      alertClass: 'CPU',
      conditionIdentity: 'CPU',
      severity: 'major',
      message: 'CPU: CPU above 90%',
      occurredAt: '2026-10-15T09:55:00.000Z',
      externalOrganizationId: 'g-1',
    });
    expect(((await processCall()) as any).raw.data.payload).toBe('95%');
  });

  it('alert_resolved → reset on the same external alert id, at resolved_at', async () => {
    const raw = JSON.stringify(
      envelope('alert_resolved', { is_resolved: true, resolved_at: '2026-10-15T10:30:00Z' }, 'evt-2'),
    );
    const res = await POST(signed(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(await processCall()).toMatchObject({
      kind: 'reset',
      externalAlertId: 'alert-9',
      occurredAt: '2026-10-15T10:30:00.000Z',
    });
  });

  it('a redelivery with the same event_id is a 2xx no-op', async () => {
    const raw = JSON.stringify(envelope('alert_active'));
    expect((await POST(signed(raw, sign(raw)))).status).toBe(200);
    expect(h.processRmmAlertEvent).toHaveBeenCalledTimes(1);

    const again = await POST(signed(raw, sign(raw)));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ ok: true, recorded: false, reason: 'duplicate_event' });
    expect(h.processRmmAlertEvent).toHaveBeenCalledTimes(1);
  });

  it('a processing failure releases the event claim so Level\'s retry is processed', async () => {
    const raw = JSON.stringify(envelope('alert_active'));
    h.processRmmAlertEvent.mockRejectedValueOnce(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await POST(signed(raw, sign(raw)))).status).toBe(500);
    spy.mockRestore();
    expect((await POST(signed(raw, sign(raw)))).status).toBe(200);
    expect(h.processRmmAlertEvent).toHaveBeenCalledTimes(2);
  });

  it.each(['device_created', 'device_updated', 'group_created', 'group_deleted', 'something_new'])(
    '%s → 2xx acknowledgement, nothing recorded',
    async (eventType) => {
      const raw = JSON.stringify({ event_type: eventType, event_id: 'evt-x', occurred_at: '2026-10-15T10:00:00Z', data: { id: 'x' } });
      const res = await POST(signed(raw, sign(raw)));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, recorded: false });
      expect(h.processRmmAlertEvent).not.toHaveBeenCalled();
    },
  );

  it('a signed alert event without data.id or device_id is acknowledged, not retried', async () => {
    const raw = JSON.stringify(envelope('alert_active', { id: undefined }));
    const res = await POST(signed(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(h.processRmmAlertEvent).not.toHaveBeenCalled();
  });

  it('a validly signed non-JSON body → 400', async () => {
    const raw = '{nope';
    expect((await POST(signed(raw, sign(raw)))).status).toBe(400);
  });
});
