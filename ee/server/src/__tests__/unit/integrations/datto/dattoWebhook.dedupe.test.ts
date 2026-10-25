import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RECONCILIATION_INGEST_MARKER } from '@alga-psa/shared/rmm/alerts/reconciliation';

let secretProvider: { getTenantSecret: (tenant: string, key: string) => Promise<string | null> };
let state: {
  rmm_integrations: any[];
  rmm_webhook_events: any[];
  tenant_external_entity_mappings: any[];
  rmm_organization_mappings: any[];
};
let client: { getAlert: ReturnType<typeof vi.fn> } | null;
let processError: Error | null;

const processRmmAlertEvent = vi.fn(async () => {
  if (processError) throw processError;
  return { outcome: 'recorded_only', alertId: 'alert-1', warnings: [] };
});
const syncDattoSingleDeviceForTenant = vi.fn(async (_args: any): Promise<any> => ({ updated: true }));
const publishEvent = vi.fn(async () => undefined);

// next/server's after() needs a live request scope; collect the tasks instead
// so tests can check they are deferred past the response and then run them.
let afterTasks: Array<() => Promise<unknown>> = [];
vi.mock('next/server', async () => {
  const actual: any = await vi.importActual('next/server');
  return { ...actual, after: (task: () => Promise<unknown>) => void afterTasks.push(task) };
});
const runAfterTasks = async () => {
  const tasks = afterTasks;
  afterTasks = [];
  for (const task of tasks) await task();
};

/** Just enough of the knex builder for the route's rmm_integrations / rmm_webhook_events / mapping calls. */
class QB {
  private wheres: Record<string, any>[] = [];
  private pending: any = null;
  private deleting = false;
  private notNulls: string[] = [];
  constructor(private readonly table: keyof typeof state) {}
  where(w: Record<string, any>) {
    this.wheres.push(w);
    return this;
  }
  whereNotNull(col: string) {
    this.notNulls.push(col);
    return this;
  }
  async select(_cols?: string[]) {
    return this.rows();
  }
  private rows() {
    return state[this.table]
      .filter((r) => this.wheres.every((w) => Object.entries(w).every(([k, v]) => r[k] === v)))
      .filter((r) => this.notNulls.every((c) => r[c] != null));
  }
  async first() {
    return this.rows()[0];
  }
  insert(row: any) {
    this.pending = row;
    return this;
  }
  onConflict(_cols: string[]) {
    return this;
  }
  ignore() {
    return this;
  }
  async returning(_cols: string[]) {
    const dup = state[this.table].find(
      (r) => r.tenant === this.pending.tenant && r.provider === this.pending.provider && r.event_id === this.pending.event_id
    );
    if (dup) return [];
    state[this.table].push({ ...this.pending });
    return [{ event_id: this.pending.event_id }];
  }
  del() {
    const keep = state[this.table].filter((r) => !this.rows().includes(r));
    (state[this.table] as any[]).splice(0, state[this.table].length, ...keep);
    return Promise.resolve(1);
  }
}

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => secretProvider),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  isTenantSuspended: vi.fn(async () => false),
  tenantDb: () => ({ table: (t: string) => new QB(t as any) }),
}));
vi.mock('@alga-psa/shared/rmm/alerts', async () => {
  const actual: any = await vi.importActual('@alga-psa/shared/rmm/alerts');
  return { ...actual, processRmmAlertEvent: (...a: any[]) => (processRmmAlertEvent as any)(...a) };
});
vi.mock('@alga-psa/integrations/lib/rmm/alerts/pipelineDeps', () => ({
  buildRmmAlertPipelineDeps: vi.fn(() => ({})),
}));
const buildDattoClientForTenant = vi.fn(async (..._args: any[]) => client);
vi.mock('@ee/lib/integrations/datto/buildClient', () => ({
  buildDattoClientForTenant: (...a: any[]) => (buildDattoClientForTenant as any)(...a),
}));
vi.mock('@ee/lib/integrations/datto/syncSingleDevice', () => ({
  syncDattoSingleDeviceForTenant: (a: any) => syncDattoSingleDeviceForTenant(a),
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: (...a: any[]) => (publishEvent as any)(...a),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

const fetchedAlert = {
  alertUid: 'alert-1',
  priority: 'High',
  diagnostics: 'Service Spooler stopped',
  resolved: false,
  timestamp: 1_776_073_284_000,
  alertContext: { '@class': 'srvc_status_ctx', processName: 'Spooler' },
  alertSourceInfo: { deviceUid: 'dev-1', deviceName: 'PC-01', siteUid: 'site-1' },
};

const call = async (body: Record<string, unknown>) => {
  const { POST } = await import('@ee/app/api/webhooks/datto/route');
  return POST(
    new Request('http://localhost/api/webhooks/datto?tenant=tenant_1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Alga-Webhook-Secret': 'expected_secret' },
      body: JSON.stringify(body),
    })
  );
};

describe('Datto webhook processing and dedupe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    processError = null;
    afterTasks = [];
    state = {
      rmm_integrations: [{ tenant: 'tenant_1', provider: 'datto', integration_id: 'int_1', is_active: true }],
      rmm_webhook_events: [],
      tenant_external_entity_mappings: [
        {
          integration_type: 'datto',
          alga_entity_type: 'asset',
          external_entity_id: 'dev-1',
          alga_entity_id: 'asset-1',
        },
      ],
      rmm_organization_mappings: [
        { integration_id: 'int_1', external_organization_id: 'site-1', client_id: 'client-1' },
        { integration_id: 'int_1', external_organization_id: 'site-no-client', client_id: null },
        { integration_id: 'int_other', external_organization_id: 'site-other', client_id: 'client-2' },
      ],
    };
    client = { getAlert: vi.fn(async () => fetchedAlert) };
    secretProvider = {
      getTenantSecret: vi.fn(async (_t: string, key: string) =>
        key === 'datto_rmm_webhook_secret' ? 'expected_secret' : null
      ),
    };
  });

  it('T042: fetches the authoritative alert, maps it, runs the pipeline, then refreshes the device', async () => {
    const res = await call({ alertUid: 'alert-1', deviceUid: 'dev-1', event: 'trigger' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, recorded: true, outcome: 'recorded_only' });
    expect(client!.getAlert).toHaveBeenCalledWith('alert-1');

    expect(processRmmAlertEvent).toHaveBeenCalledTimes(1);
    expect((processRmmAlertEvent as any).mock.calls[0][1]).toEqual(
      expect.objectContaining({
        tenantId: 'tenant_1',
        integrationId: 'int_1',
        provider: 'datto',
        kind: 'triggered',
        externalAlertId: 'alert-1',
        externalDeviceId: 'dev-1',
        externalOrganizationId: 'site-1',
        severity: 'major',
        alertClass: 'srvc_status_ctx',
      })
    );
    // The refresh is deferred until after the response.
    expect(syncDattoSingleDeviceForTenant).not.toHaveBeenCalled();
    await runAfterTasks();
    expect(syncDattoSingleDeviceForTenant).toHaveBeenCalledWith(
      expect.objectContaining({ tenant: 'tenant_1', deviceUid: 'dev-1' })
    );
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'RMM_WEBHOOK_RECEIVED',
        payload: expect.objectContaining({ provider: 'datto', assetId: 'asset-1', externalDeviceId: 'dev-1' }),
      })
    );
    expect(state.rmm_webhook_events).toEqual([
      expect.objectContaining({ tenant: 'tenant_1', provider: 'datto', event_id: 'alert-1:trigger' }),
    ]);
  });

  it('T042: a repeat of the same alert + event is a duplicate no-op; a different event is not', async () => {
    await call({ alertUid: 'alert-1', deviceUid: 'dev-1' });
    processRmmAlertEvent.mockClear();
    client!.getAlert.mockClear();

    const dup = await call({ alertUid: 'alert-1', deviceUid: 'dev-1', event: 'trigger' });
    expect(dup.status).toBe(200);
    expect(await dup.json()).toEqual(expect.objectContaining({ ok: true, duplicate: true }));
    expect(processRmmAlertEvent).not.toHaveBeenCalled();
    expect(client!.getAlert).not.toHaveBeenCalled();

    const resolve = await call({ alertUid: 'alert-1', deviceUid: 'dev-1', event: 'resolve' });
    expect(resolve.status).toBe(200);
    expect(processRmmAlertEvent).toHaveBeenCalledTimes(1);
    expect((processRmmAlertEvent as any).mock.calls[0][1].kind).toBe('reset');
    expect(state.rmm_webhook_events.map((e) => e.event_id).sort()).toEqual(['alert-1:resolve', 'alert-1:trigger']);
  });

  it('builds its Datto client with a small retry budget so the handler never sleeps for minutes', async () => {
    await call({ alertUid: 'alert-1', deviceUid: 'dev-1' });
    expect(buildDattoClientForTenant).toHaveBeenCalledWith('tenant_1', { maxRetries: 1, maxRetryAfterMs: 5000 });
  });

  it('stamps the poller ingest marker on the processed event so reconciliation can auto-reset it', async () => {
    await call({ alertUid: 'alert-1', deviceUid: 'dev-1' });
    const event = (processRmmAlertEvent as any).mock.calls[0][1];
    expect(event.raw).toMatchObject({ alertUid: 'alert-1', [RECONCILIATION_INGEST_MARKER]: 'reconciliation' });
    // The fetched alert object itself is not mutated.
    expect(fetchedAlert).not.toHaveProperty(RECONCILIATION_INGEST_MARKER);
  });

  it('stamps the marker on the payload-only fallback too', async () => {
    client!.getAlert.mockRejectedValue(new Error('Datto down'));
    await call({ alertUid: 'alert-9', deviceUid: 'dev-1', siteUid: 'site-1' });
    expect((processRmmAlertEvent as any).mock.calls[0][1].raw).toMatchObject({
      [RECONCILIATION_INGEST_MARKER]: 'reconciliation',
    });
  });

  it('ignores alerts from sites that are not mapped to a client (fetched site wins over the payload)', async () => {
    client!.getAlert.mockResolvedValue({
      ...fetchedAlert,
      alertSourceInfo: { deviceUid: 'dev-1', deviceName: 'PC-01', siteUid: 'site-unmapped' },
    });
    const res = await call({ alertUid: 'alert-1', deviceUid: 'dev-1', siteUid: 'site-1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, recorded: false, reason: 'site_not_mapped' });
    expect(processRmmAlertEvent).not.toHaveBeenCalled();
    expect(syncDattoSingleDeviceForTenant).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('gates on the payload site before calling Datto, so an unmapped site costs no API request', async () => {
    const res = await call({ alertUid: 'alert-1', deviceUid: 'dev-1', siteUid: 'site-unmapped' });
    expect(await res.json()).toEqual({ ok: true, recorded: false, reason: 'site_not_mapped' });
    expect(buildDattoClientForTenant).not.toHaveBeenCalled();
    expect(client!.getAlert).not.toHaveBeenCalled();
    expect(processRmmAlertEvent).not.toHaveBeenCalled();
  });

  it('acks a triggered alert that Datto reports as muted without processing it', async () => {
    client!.getAlert.mockResolvedValue({ ...fetchedAlert, muted: true });
    const res = await call({ alertUid: 'alert-1', deviceUid: 'dev-1', event: 'trigger' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, recorded: false, reason: 'alert_muted' });
    expect(processRmmAlertEvent).not.toHaveBeenCalled();
    expect(syncDattoSingleDeviceForTenant).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('releases the dedupe claim when it ignores an alert, so a redelivery after mapping or unmuting is processed', async () => {
    const unmapped = await call({ alertUid: 'alert-1', deviceUid: 'dev-1', siteUid: 'site-unmapped' });
    expect(await unmapped.json()).toEqual(expect.objectContaining({ reason: 'site_not_mapped' }));
    expect(state.rmm_webhook_events).toEqual([]);

    client!.getAlert.mockResolvedValueOnce({ ...fetchedAlert, muted: true });
    const muted = await call({ alertUid: 'alert-1', deviceUid: 'dev-1' });
    expect(await muted.json()).toEqual(expect.objectContaining({ reason: 'alert_muted' }));
    expect(state.rmm_webhook_events).toEqual([]);

    const redelivered = await call({ alertUid: 'alert-1', deviceUid: 'dev-1' });
    expect(await redelivered.json()).toEqual(expect.objectContaining({ recorded: true }));
    expect(processRmmAlertEvent).toHaveBeenCalledTimes(1);
  });

  it('still processes a resolve for a muted alert so an ingested alert can close', async () => {
    client!.getAlert.mockResolvedValue({ ...fetchedAlert, muted: true, resolved: true });
    const res = await call({ alertUid: 'alert-1', deviceUid: 'dev-1', event: 'resolve' });
    expect(await res.json()).toEqual(expect.objectContaining({ recorded: true }));
    expect((processRmmAlertEvent as any).mock.calls[0][1].kind).toBe('reset');
  });

  it('processes an alert whose muted flag is false', async () => {
    client!.getAlert.mockResolvedValue({ ...fetchedAlert, muted: false });
    const res = await call({ alertUid: 'alert-1', deviceUid: 'dev-1' });
    expect(await res.json()).toEqual(expect.objectContaining({ recorded: true }));
  });

  it('treats a mapping without a client, another integration\'s mapping, or no site at all as not mapped', async () => {
    for (const siteUid of ['site-no-client', 'site-other', null]) {
      client!.getAlert.mockResolvedValue({
        ...fetchedAlert,
        alertUid: `alert-${siteUid}`,
        alertSourceInfo: { deviceUid: 'dev-1', siteUid },
      });
      const res = await call({ alertUid: `alert-${siteUid}`, deviceUid: 'dev-1' });
      expect(await res.json()).toEqual({ ok: true, recorded: false, reason: 'site_not_mapped' });
    }
    expect(processRmmAlertEvent).not.toHaveBeenCalled();
  });

  it('also drops resolve events and payload-only fallbacks for unmapped sites', async () => {
    client!.getAlert.mockResolvedValue({
      ...fetchedAlert,
      alertSourceInfo: { deviceUid: 'dev-1', siteUid: 'site-unmapped' },
    });
    const resolve = await call({ alertUid: 'alert-1', deviceUid: 'dev-1', event: 'resolve' });
    expect(await resolve.json()).toEqual({ ok: true, recorded: false, reason: 'site_not_mapped' });

    client!.getAlert.mockRejectedValue(new Error('Datto down'));
    const fallback = await call({ alertUid: 'alert-7', deviceUid: 'dev-1', siteUid: 'site-unmapped' });
    expect(await fallback.json()).toEqual({ ok: true, recorded: false, reason: 'site_not_mapped' });
  });

  it('maps the payload-only fallback through the mapper: a class-less alert gets its own identity, not the shared bucket', async () => {
    client!.getAlert.mockRejectedValue(new Error('Datto down'));
    await call({ alertUid: 'alert-9', deviceUid: 'dev-1', siteUid: 'site-1', alertType: '[alert_type]' });
    await call({ alertUid: 'alert-10', deviceUid: 'dev-1', siteUid: 'site-1', alertType: '[alert_type]' });
    const [first, second] = (processRmmAlertEvent as any).mock.calls.map((c: any[]) => c[1]);
    expect(first.conditionIdentity).toBe('alert=alert-9');
    expect(second.conditionIdentity).toBe('alert=alert-10');
  });

  it('maps resolved=true on the fetched alert to a reset even for a trigger-labelled delivery', async () => {
    client!.getAlert.mockResolvedValue({ ...fetchedAlert, resolved: true });
    await call({ alertUid: 'alert-1', deviceUid: 'dev-1' });
    expect((processRmmAlertEvent as any).mock.calls[0][1].kind).toBe('reset');
  });

  it('falls back to the webhook payload when the Datto lookup fails, so the alert is not lost', async () => {
    client!.getAlert.mockRejectedValue(new Error('Datto down'));
    const res = await call({
      alertUid: 'alert-9',
      deviceUid: 'dev-1',
      siteUid: 'site-1',
      hostname: 'PC-01',
      alertType: '[alert_type]',
    });
    expect(res.status).toBe(200);
    expect((processRmmAlertEvent as any).mock.calls[0][1]).toEqual(
      expect.objectContaining({
        externalAlertId: 'alert-9',
        externalDeviceId: 'dev-1',
        externalOrganizationId: 'site-1',
        deviceName: 'PC-01',
        kind: 'triggered',
      })
    );
  });

  it('does not fail the request when the single-device refresh throws', async () => {
    syncDattoSingleDeviceForTenant.mockRejectedValueOnce(new Error('sync failed'));
    const res = await call({ alertUid: 'alert-1', deviceUid: 'dev-1' });
    expect(res.status).toBe(200);
    await expect(runAfterTasks()).resolves.toBeUndefined();
  });

  it('releases the dedupe claim on a processing failure so a retry is processed', async () => {
    processError = new Error('pipeline exploded');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await call({ alertUid: 'alert-1', deviceUid: 'dev-1' });
    expect(res.status).toBe(500);
    expect(state.rmm_webhook_events).toEqual([]);

    processError = null;
    const retry = await call({ alertUid: 'alert-1', deviceUid: 'dev-1' });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(expect.objectContaining({ recorded: true }));
    errSpy.mockRestore();
  });

  it('acks without recording when no active Datto integration exists', async () => {
    state.rmm_integrations[0].is_active = false;
    const res = await call({ alertUid: 'alert-1', deviceUid: 'dev-1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, recorded: false, reason: 'integration_not_configured' });
    expect(processRmmAlertEvent).not.toHaveBeenCalled();
  });
});
