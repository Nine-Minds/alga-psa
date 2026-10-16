/**
 * Level.io alert ingestion, end to end through the algasim Level emulator.
 *
 * The real EE webhook route runs behind a local HTTP listener against a real
 * database. The emulator plays Level: it sends native webhooks and monitor
 * automation HTTP requests exactly as Level does, and serves the v2 REST API
 * the route calls back into (LEVELIO_API_BASE_URL). The two prod-failure
 * scenarios are the bundled suite files
 * (packages/emulators/suite/scenarios/levelio-*.yaml), retargeted at the route.
 *
 * The first two tests are the 2026-10-15 production failures, now fixed:
 *   (a) native Settings -> Webhooks deliveries (X-Level-Signature, HMAC over
 *       the raw body) are accepted with 2xx and create tickets; resolving
 *       resets the alert; a redelivery of the same event_id is a no-op;
 *   (b) the automation template Alga hands out renders only documented system
 *       variables and produces distinct alerts and tickets (no collapse).
 * The third test is the original control for the system-variable shape.
 */

import { readFileSync } from 'node:fs';
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { EmulatorHost, loadScenarioFile, runScenario } from '@alga-psa/emulator-host';
import levelio, { retargetScenario, type LevelEmulatorCore } from '@alga-psa/emulator-levelio';
import { createTestDbConnection } from '@main-test-utils/dbConfig';

const HOOK_TIMEOUT = 180_000;

const ALGA_WEBHOOK_SECRET = 'algasim-alga-webhook-secret';
const LEVEL_WEBHOOK_SIGNING_SECRET = 'algasim-level-webhook-secret';
const LEVEL_API_KEY = 'algasim-level-key';

const h = vi.hoisted(() => ({ db: null as unknown as Knex }));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getAppSecret: async () => undefined,
    getTenantSecret: async (_tenant: string, name: string) =>
      ({
        levelio_webhook_secret: ALGA_WEBHOOK_SECRET,
        levelio_webhook_signing_secret: LEVEL_WEBHOOK_SIGNING_SECRET,
        levelio_api_key: LEVEL_API_KEY,
      })[name],
    setTenantSecret: async () => undefined,
  }),
}));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return { ...actual, createTenantKnex: async (tenant?: string) => ({ knex: h.db, tenant: tenant ?? null }) };
});

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
}));

const { POST } = await import('../../app/api/webhooks/levelio/route');

/**
 * The payload template and header name getLevelIoWebhookInfo hands out, read
 * from source (the server action itself needs a session and tier gate).
 */
function algaSettingsTemplate(): { headerName: string; payloadTemplate: string } {
  const source = readFileSync(new URL('../../lib/actions/integrations/levelIoActions.ts', import.meta.url), 'utf8');
  const literal = /const payloadTemplate = JSON\.stringify\(\s*(\{[\s\S]*?\})\s*,\s*null\s*,\s*2\s*\)/.exec(source)?.[1];
  const headerName = /headerName: '([^']+)'/.exec(source)?.[1];
  if (!literal || !headerName) throw new Error('getLevelIoWebhookInfo no longer builds a payload template; update this test');
  return { headerName, payloadTemplate: JSON.stringify(new Function(`return (${literal});`)(), null, 2) };
}

const tenantId = uuidv4();
const userId = uuidv4();
const clientId = uuidv4();
const boardId = uuidv4();
const integrationId = uuidv4();

// Fixed ids from the scenario files.
const ACME = 'Z2lkOi8vbGV2ZWwvRGV2aWNlR3JvdXAvMQ';
const BRANCH = 'Z2lkOi8vbGV2ZWwvRGV2aWNlR3JvdXAvMg';
const WS_01 = 'Z2lkOi8vbGV2ZWwvRGV2aWNlLzE';
const SRV_01 = 'Z2lkOi8vbGV2ZWwvRGV2aWNlLzI';

const SCENARIOS = new URL('../../../../../packages/emulators/suite/scenarios/', import.meta.url);

let routeServer: http.Server;
let routeOrigin: string;
let host: EmulatorHost;
let control: string;

function table(name: string) {
  return tenantDb(h.db, tenantId).table(name);
}

async function hasColumn(name: string, column: string) {
  return h.db.schema.hasColumn(name, column);
}

/** The Next route handler behind a real socket, so the emulator talks HTTP to it. */
async function startRouteServer() {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers.set(name, value);
    }
    const response = await POST(
      new Request(`${routeOrigin}${req.url}`, { method: req.method, headers, body: Buffer.concat(chunks) }),
    );
    res.writeHead(response.status, { 'content-type': 'application/json' });
    res.end(await response.text());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  routeOrigin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return server;
}

async function runLevelScenario(name: string) {
  const scenario = retargetScenario(loadScenarioFile(new URL(`${name}.yaml`, SCENARIOS).pathname), {
    'http://localhost:4030': routeOrigin,
    'tenant=algasim-tenant': `tenant=${tenantId}`,
  });
  await runScenario(host, scenario);
}

async function levelState(view: string) {
  return ((await (await fetch(`${control}/control/levelio/state/${view}`)).json()) as { result: any }).result;
}

async function rmmAlerts() {
  return table('rmm_alerts').where({ tenant: tenantId }).select('external_alert_id', 'external_device_id', 'ticket_id', 'status');
}

async function ticketCount() {
  const row = await table('tickets').where({ tenant: tenantId }).count('ticket_id as n').first();
  return Number(row?.n ?? 0);
}

async function clearAlertsAndTickets() {
  for (const name of ['comments', 'comment_threads', 'asset_associations', 'rmm_webhook_events', 'rmm_alerts', 'tickets']) {
    await table(name).where({ tenant: tenantId }).del().catch(() => undefined);
  }
}

beforeAll(async () => {
  process.env.DB_PORT = process.env.DB_PORT || '5432';
  process.env.APP_ENV = process.env.APP_ENV || 'test';
  h.db = await createTestDbConnection();

  await table('tenants').insert({
    tenant: tenantId,
    ...((await hasColumn('tenants', 'company_name')) ? { company_name: 'Level Emulator Tenant' } : { client_name: 'Level Emulator Tenant' }),
    email: `level-emu-${tenantId.slice(0, 8)}@example.com`,
    created_at: h.db.fn.now(),
    updated_at: h.db.fn.now(),
  });
  await table('users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `level-emu-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `level-emu-user-${tenantId.slice(0, 8)}@example.com`,
    created_at: h.db.fn.now(),
    updated_at: h.db.fn.now(),
  });
  await table('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: 'Acme Corp',
    properties: JSON.stringify({}),
    is_inactive: false,
    created_at: h.db.fn.now(),
    updated_at: h.db.fn.now(),
  });
  await table('boards').insert({ tenant: tenantId, board_id: boardId, board_name: 'Alerts', is_default: true });
  const statusItemType = {
    ...((await hasColumn('statuses', 'item_type')) ? { item_type: 'ticket' } : {}),
    ...((await hasColumn('statuses', 'status_type')) ? { status_type: 'ticket' } : {}),
  };
  await table('statuses').insert([
    { tenant: tenantId, status_id: uuidv4(), name: 'Open', ...statusItemType, board_id: boardId, is_closed: false, is_default: true, order_number: 10, created_by: userId },
    { tenant: tenantId, status_id: uuidv4(), name: 'Closed', ...statusItemType, board_id: boardId, is_closed: true, is_default: false, order_number: 20, created_by: userId },
  ]);
  await table('rmm_integrations').insert({
    tenant: tenantId,
    integration_id: integrationId,
    provider: 'levelio',
    instance_url: 'https://api.level.io',
    is_active: true,
    connected_at: h.db.fn.now(),
    settings: JSON.stringify({}),
  });
  await table('rmm_organization_mappings').insert({
    tenant: tenantId,
    mapping_id: uuidv4(),
    integration_id: integrationId,
    external_organization_id: ACME,
    external_organization_name: 'Acme Corp',
    client_id: clientId,
    default_contact_id: null,
    auto_sync_assets: true,
    auto_create_tickets: false,
  });
  // Both scenario devices, synced: the realm is the deepest mapped group (Acme).
  for (const [deviceId, name] of [[WS_01, 'WS-01'], [SRV_01, 'SRV-01']] as const) {
    const assetId = uuidv4();
    await table('assets').insert({
      tenant: tenantId,
      asset_id: assetId,
      asset_type: deviceId === SRV_01 ? 'server' : 'workstation',
      name,
      asset_tag: `levelio:${deviceId}`,
      serial_number: `SN-${name}`,
      status: 'active',
      client_id: clientId,
      rmm_provider: 'levelio',
      rmm_device_id: deviceId,
      created_at: h.db.fn.now(),
      updated_at: h.db.fn.now(),
    });
    await table('tenant_external_entity_mappings').insert({
      tenant: tenantId,
      id: uuidv4(),
      integration_type: 'levelio',
      alga_entity_type: 'asset',
      alga_entity_id: assetId,
      external_entity_id: deviceId,
      external_realm_id: ACME,
      sync_status: 'synced',
      created_at: h.db.fn.now(),
      updated_at: h.db.fn.now(),
    });
  }
  // The prod shape: a group-scoped rule that tickets every Acme alert.
  await table('rmm_alert_rules').insert({
    tenant: tenantId,
    rule_id: uuidv4(),
    integration_id: integrationId,
    name: 'Acme alerts',
    is_active: true,
    priority_order: 0,
    conditions: JSON.stringify({ organizationIds: [ACME] }),
    actions: JSON.stringify({ createTicket: true, boardId }),
  });

  routeServer = await startRouteServer();
  host = new EmulatorHost({ emulators: [levelio], controlPort: 0, ports: { levelio: 0 } });
  const started = await host.start();
  control = `http://127.0.0.1:${started.controlPort}`;
  process.env.LEVELIO_API_BASE_URL = `http://127.0.0.1:${started.ports.levelio}`;
  process.env.LEVELIO_SYNC_TRANSPORT = 'direct';
}, HOOK_TIMEOUT);

afterAll(async () => {
  await host?.stop();
  await new Promise((resolve) => routeServer?.close(resolve));
  if (!h.db) return;
  await clearAlertsAndTickets();
  for (const name of [
    'next_number', 'rmm_webhook_events', 'rmm_alert_rules', 'tenant_external_entity_mappings', 'rmm_organization_mappings',
    'rmm_integrations', 'assets', 'statuses', 'boards', 'clients', 'users', 'tenants',
  ]) {
    await table(name).where({ tenant: tenantId }).del().catch(() => undefined);
  }
  await h.db.destroy().catch(() => undefined);
}, HOOK_TIMEOUT);

describe('Level.io alert ingestion through the Level emulator (route + DB)', { shuffle: false }, () => {
  it('native signed webhooks are accepted with 2xx and create tickets; resolve resets; redelivery is a no-op', async () => {
    await clearAlertsAndTickets();
    await runLevelScenario('levelio-native-webhook-signed');

    const deliveries = await levelState('webhook-deliveries');
    expect(deliveries).toHaveLength(2);
    for (const delivery of deliveries) {
      expect(delivery.signature).toMatch(/^sha256=[0-9a-f]{64}$/);
      expect(delivery.status).toBe(200);
      expect(JSON.parse(delivery.response)).toMatchObject({ ok: true, recorded: true, outcome: 'ticket_created' });
    }
    const alerts = await rmmAlerts();
    expect(alerts).toHaveLength(2);
    expect(alerts.every((a: { ticket_id: string | null }) => a.ticket_id)).toBe(true);
    expect(await ticketCount()).toBe(2);
    // The platform alert id (data.id) is the external alert id; WS-01's group
    // is the unmapped Branch Office, so the ticket still lands on Acme Corp.
    const tickets = await table('tickets').where({ tenant: tenantId }).select('client_id');
    expect(tickets.every((t: { client_id: string }) => t.client_id === clientId)).toBe(true);

    // Resolve the first alert: Level sends alert_resolved with the same data.id.
    const levelAlerts = await levelState('alerts');
    const cpu = levelAlerts.find((a: { device_id: string }) => a.device_id === WS_01);
    const resolveResponse = await fetch(`${control}/control/levelio/actions/resolve-alert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alertId: cpu.id }),
    });
    expect(resolveResponse.ok).toBe(true);
    const row = await table('rmm_alerts').where({ tenant: tenantId, external_alert_id: cpu.id }).first();
    expect(row.status).toBe('resolved');
    expect(await rmmAlerts()).toHaveLength(2);

    // Re-run the original alert_active delivery (same event_id): a 2xx no-op that
    // must not reopen the resolved alert, even though it arrives out of order.
    const cpuActive = deliveries[0]; // the CPU alert_active, fired first by the scenario
    const rerun = await fetch(`${control}/control/levelio/actions/rerun-delivery`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deliveryId: cpuActive.id }),
    });
    expect(rerun.ok).toBe(true);
    const after = await levelState('webhook-deliveries');
    const rerunRecord = after[after.length - 1];
    expect(rerunRecord.eventId).toBe(cpuActive.eventId);
    expect(rerunRecord.status).toBe(200);
    expect(JSON.parse(rerunRecord.response)).toMatchObject({ ok: true, recorded: false, reason: 'duplicate_event' });
    const stillResolved = await table('rmm_alerts').where({ tenant: tenantId, external_alert_id: cpu.id }).first();
    expect(stillResolved.status).toBe('resolved');
    expect(await ticketCount()).toBe(2);
  });

  it('the automation template Alga hands out produces distinct alerts and tickets (no collapse)', async () => {
    await clearAlertsAndTickets();

    // The pristine scenario automation is exactly what the settings screen hands
    // out; the other two are copies a customer edits per monitor (only name,
    // description and severity differ - every variable-valued field is the template's).
    const settings = algaSettingsTemplate();
    const template = JSON.parse(settings.payloadTemplate) as Record<string, string>;
    const scenario = loadScenarioFile(new URL('levelio-automation-alga-template.yaml', SCENARIOS).pathname);
    const automations = scenario.steps.filter(
      (step: (typeof scenario.steps)[number]) => 'seed' in step && step.seed === 'levelio/automation',
    ) as Array<{ params: { body: string; headers: Array<{ key: string; value: string }> } }>;
    expect(automations).toHaveLength(3);
    expect(automations[0].params.body).toBe(settings.payloadTemplate);
    for (const automation of automations) {
      expect(automation.params.headers).toEqual([{ key: settings.headerName, value: ALGA_WEBHOOK_SECRET }]);
      const body = JSON.parse(automation.params.body) as Record<string, string>;
      expect(Object.keys(body)).toEqual(Object.keys(template));
      const editable = new Set(['name', 'description', 'severity']);
      for (const key of Object.keys(template)) {
        if (!editable.has(key)) expect(body[key]).toBe(template[key]);
      }
      // Only Level's documented system variables, never alert_* placeholders.
      expect(Object.values(template).join(' ')).not.toMatch(/\{\{(?!level_)/);
    }

    await runLevelScenario('levelio-automation-alga-template');

    const runs = await levelState('automation-runs');
    expect(runs.map((run: { status: number }) => run.status)).toEqual([200, 200, 200]);
    expect(runs.map((run: { unresolvedVariables: string[] }) => run.unresolvedVariables)).toEqual([[], [], []]);
    expect(runs.map((run: { response: string }) => JSON.parse(run.response).outcome)).toEqual([
      'ticket_created',
      'ticket_created',
      'ticket_created',
    ]);
    const alerts = await rmmAlerts();
    expect(alerts).toHaveLength(3);
    expect(alerts.map((a: { external_alert_id: string }) => a.external_alert_id).some((id: string) => id.includes('{{'))).toBe(false);
    expect(new Set(alerts.map((a: { external_alert_id: string }) => a.external_alert_id)).size).toBe(3);
    expect(alerts.every((a: { ticket_id: string | null }) => a.ticket_id)).toBe(true);
    expect(await ticketCount()).toBe(3);
    const tickets = await table('tickets').where({ tenant: tenantId }).select('client_id');
    expect(tickets.every((t: { client_id: string }) => t.client_id === clientId)).toBe(true);
  });

  it('old automations that still send the literal {{alert_id}} template are rejected and record nothing', async () => {
    await clearAlertsAndTickets();
    const res = await fetch(`${routeOrigin}/api/webhooks/levelio?tenant=${tenantId}`, {
      method: 'POST',
      headers: { 'x-alga-webhook-secret': ALGA_WEBHOOK_SECRET, 'content-type': 'application/json' },
      body: JSON.stringify({
        event: 'alert.triggered',
        alert_id: '{{alert_id}}',
        device_id: '{{device_id}}',
        hostname: '{{hostname}}',
        name: '{{alert_name}}',
        severity: '{{severity}}',
        description: '{{description}}',
      }),
    });
    expect(res.status).toBe(400);
    expect(await rmmAlerts()).toEqual([]);
    expect(await ticketCount()).toBe(0);
  });

  it('the cleanup migration auto-resolves only open levelio {{...}} rows and leaves tickets alone', async () => {
    await clearAlertsAndTickets();
    const base = { tenant: tenantId, integration_id: integrationId, severity: 'none', source_type: 'levelio_webhook' };
    const junk = uuidv4();
    const real = uuidv4();
    await table('rmm_alerts').insert([
      { ...base, alert_id: junk, external_alert_id: '{{alert_id}}', status: 'active' },
      { ...base, alert_id: real, external_alert_id: 'real-alert-1', status: 'active' },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const migration = (await import('../../../../../server/migrations/20261015180000_create_rmm_webhook_events_and_resolve_levelio_placeholder_alerts.cjs')) as any;
    await (migration.up ?? migration.default.up)(h.db);
    const rows = await table('rmm_alerts').where({ tenant: tenantId }).select('alert_id', 'status');
    expect(rows.find((r: { alert_id: string }) => r.alert_id === junk).status).toBe('auto_resolved');
    expect(rows.find((r: { alert_id: string }) => r.alert_id === real).status).toBe('active');
  });

  it('control: the same route tickets an alert whose payload uses Level\'s documented system variables', async () => {
    await clearAlertsAndTickets();
    await fetch(`${control}/control/levelio/reset`, { method: 'POST' });
    const call = (path: string, body: unknown) =>
      fetch(`${control}/control/levelio/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json() as Promise<{ ok: boolean; result: any }>);

    await call('seed/group', { id: ACME, name: 'Acme Corp' });
    await call('seed/group', { id: BRANCH, name: 'Branch Office', parentId: ACME });
    await call('seed/device', { id: SRV_01, hostname: 'SRV-01', role: 'server', groupId: ACME, serial_number: 'SN-SRV-01' });
    await call('seed/automation', {
      name: 'Forward alerts to Alga (system variables)',
      url: `${routeOrigin}/api/webhooks/levelio?tenant=${tenantId}`,
      headers: [{ key: 'X-Alga-Webhook-Secret', value: ALGA_WEBHOOK_SECRET }],
      body: JSON.stringify({
        event: 'alert.triggered',
        alert_id: '{{level_device_id}}:cpu:{{level_time}}',
        device_id: '{{level_device_id}}',
        hostname: '{{level_device_hostname}}',
        group_id: '{{level_group_id}}',
        name: 'CPU',
        severity: 'critical',
      }),
    });
    const fired = await call('actions/fire-alert', { deviceId: SRV_01, name: 'CPU', severity: 'critical' });

    expect(fired.result.automationRuns).toHaveLength(1);
    expect(fired.result.automationRuns[0].unresolvedVariables).toEqual([]);
    expect(JSON.parse(fired.result.automationRuns[0].response)).toMatchObject({ ok: true, outcome: 'ticket_created' });
    const alerts = await rmmAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].external_device_id).toBe(SRV_01);
    expect(alerts[0].ticket_id).not.toBeNull();
    expect(await ticketCount()).toBe(1);
    const ticket = await table('tickets').where({ tenant: tenantId }).first();
    expect(ticket.client_id).toBe(clientId);
  });
});
