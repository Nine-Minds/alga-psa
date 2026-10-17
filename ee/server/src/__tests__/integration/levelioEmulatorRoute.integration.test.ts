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
 * KNOWN PROD FAILURES (2026-10-15). The first two tests assert the broken
 * behavior the route had when they were written:
 *   (a) native webhook with a secret → 401 on every attempt, nothing recorded;
 *   (b) Alga's pasted payload template via an automation → 200, but the
 *       literal {{alert_id}} collapses every alert into one rmm_alerts row and
 *       no ticket is created.
 * When the route fix lands they fail by design. Flip them to assert that the
 * signed envelopes are accepted and that the CPU alert on SRV-01 creates a
 * ticket for Acme Corp (the third test shows the fixture can do that).
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
const LEVEL_API_KEY = 'algasim-level-key';

const h = vi.hoisted(() => ({ db: null as unknown as Knex }));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getAppSecret: async () => undefined,
    getTenantSecret: async (_tenant: string, name: string) =>
      ({ levelio_webhook_secret: ALGA_WEBHOOK_SECRET, levelio_api_key: LEVEL_API_KEY })[name],
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
  for (const name of ['comments', 'comment_threads', 'asset_associations', 'rmm_alerts', 'tickets']) {
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
    'next_number', 'rmm_alert_rules', 'tenant_external_entity_mappings', 'rmm_organization_mappings',
    'rmm_integrations', 'assets', 'statuses', 'boards', 'clients', 'users', 'tenants',
  ]) {
    await table(name).where({ tenant: tenantId }).del().catch(() => undefined);
  }
  await h.db.destroy().catch(() => undefined);
}, HOOK_TIMEOUT);

describe('Level.io alert ingestion through the Level emulator (route + DB)', { shuffle: false }, () => {
  it('known prod failure (a): native webhooks with a secret are rejected 401 on every attempt', async () => {
    await clearAlertsAndTickets();
    await runLevelScenario('levelio-native-webhook-signed');
    const core = host.instance('levelio').core as LevelEmulatorCore;
    core.configure({ autoRetry: false });

    // Level retries each failed delivery three times, minutes apart.
    for (let round = 0; round < 3; round += 1) {
      host.clock.advance('1h');
      await fetch(`${control}/control/levelio/actions/deliver-due-retries`, { method: 'POST' });
    }

    const deliveries = await levelState('webhook-deliveries');
    expect(deliveries).toHaveLength(8);
    for (const delivery of deliveries) {
      expect(delivery.signature).toMatch(/^sha256=[0-9a-f]{64}$/);
      expect(delivery.status).toBe(401);
      expect(JSON.parse(delivery.response)).toEqual({ error: 'Unauthorized: missing webhook secret' });
    }
    expect(new Set(deliveries.map((d: { eventId: string }) => d.eventId)).size).toBe(2);
    expect(await rmmAlerts()).toEqual([]);
    expect(await ticketCount()).toBe(0);
  });

  it('known prod failure (b): the pasted Alga template collapses every alert into one row and opens no ticket', async () => {
    await clearAlertsAndTickets();

    // The scenario's automation is exactly what the settings screen hands out.
    const settings = algaSettingsTemplate();
    const scenario = loadScenarioFile(new URL('levelio-automation-alga-template.yaml', SCENARIOS).pathname);
    const automation = scenario.steps.find((step: (typeof scenario.steps)[number]) => 'seed' in step && step.seed === 'levelio/automation') as {
      params: { body: string; headers: Array<{ key: string; value: string }> };
    };
    expect(automation.params.body).toBe(settings.payloadTemplate);
    expect(automation.params.headers).toEqual([{ key: settings.headerName, value: ALGA_WEBHOOK_SECRET }]);

    await runLevelScenario('levelio-automation-alga-template');

    const runs = await levelState('automation-runs');
    expect(runs.map((run: { status: number }) => run.status)).toEqual([200, 200, 200]);
    expect(runs.map((run: { response: string }) => JSON.parse(run.response).outcome)).toEqual([
      'recorded_only',
      'skipped',
      'skipped',
    ]);
    expect(await rmmAlerts()).toEqual([
      expect.objectContaining({ external_alert_id: '{{alert_id}}', external_device_id: '{{device_id}}', ticket_id: null }),
    ]);
    expect(await ticketCount()).toBe(0);
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
