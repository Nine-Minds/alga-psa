/**
 * pollHuntressIncidents end to end: the real poller, the real incident
 * processor and a real migrated database, with the algasim Huntress emulator
 * playing Huntress over HTTP (rmm_integrations.instance_url points at it, as a
 * tenant connected through the integration card would).
 *
 * This is the first coverage of the Huntress poll cycle against an HTTP vendor:
 * the backfill window, routing to a mapped board, fallback routing plus
 * on-demand organization discovery, hostname asset matching, the status-change
 * note, auto-close, cursor advancement past successes only, and the list
 * failure / rate-limit paths.
 *
 * PR #3814 (escalation ingestion) is not on this branch, so there is no
 * escalations/ module to drive here. The emulator's escalation surface and its
 * wire tests ship with this change; the product-side escalation cases
 * (ingestEscalations off/on, per-organization tickets, dropped organization,
 * resolved → close, stream-failure isolation, cursor reset) land with #3814.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { EmulatorHost } from '@alga-psa/emulator-host';
import huntress from '@alga-psa/emulator-huntress';
import { createTestDbConnection } from '@main-test-utils/dbConfig';

const HOOK_TIMEOUT = 180_000;
const TEST_TIMEOUT = 120_000;

const API_KEY = 'algasim-huntress-key';
const API_SECRET = 'algasim-huntress-secret';

const h = vi.hoisted(() => ({ db: null as unknown as Knex }));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getAppSecret: async () => undefined,
    getTenantSecret: async (_tenant: string, name: string) =>
      ({ huntress_api_key: 'algasim-huntress-key', huntress_api_secret: 'algasim-huntress-secret' })[name],
    setTenantSecret: async () => undefined,
  }),
}));

vi.mock('@/lib/db', () => ({
  createTenantKnex: async (tenant?: string) => ({ knex: h.db, tenant: tenant ?? null }),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
}));

const { pollHuntressIncidents } = await import('../../lib/integrations/huntress/incidents/incidentPoller');
const { parseHuntressSettings } = await import('../../lib/integrations/huntress/settings');

// Fixture ids
const tenantId = uuidv4();
const userId = uuidv4();
const clientId = uuidv4();
const fallbackClientId = uuidv4();
const primaryContactId = uuidv4();
const mappingDefaultContactId = uuidv4();
const securityBoardId = uuidv4();
const triageBoardId = uuidv4();
const statusOpenId = uuidv4();
const statusClosedId = uuidv4();
const pCritId = uuidv4();
const pHighId = uuidv4();
const pLowId = uuidv4();
const integrationId = uuidv4();
const assetId = uuidv4();
/** A category id that is not in `categories`, to fail one incident on purpose. */
const missingCategoryId = uuidv4();

const MAPPED_ORG = 500;
const UNMAPPED_ORG = 600;
const AGENT_ID = 7;

let host: EmulatorHost;
let control: string;
let vendor: string;
let db: Knex;

const baseSettings = {
  accountSubdomain: 'acme',
  boardId: securityBoardId,
  fallbackClientId,
  fallbackBoardId: triageBoardId,
  severityPriorityMap: { critical: pCritId, high: pHighId, low: pLowId },
  autoCloseTickets: true,
  closedStatusId: statusClosedId,
  backfillDays: 7,
};

function tenantTable(table: string) {
  return tenantDb(db, tenantId).table(table);
}

async function hasColumn(table: string, column: string): Promise<boolean> {
  return db.schema.hasColumn(table, column);
}

async function callControl(kind: 'seed' | 'actions', name: string, params: unknown = {}) {
  const response = await fetch(`${control}/control/huntress/${kind}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const json = (await response.json()) as { ok: boolean; result?: any; error?: string };
  if (!json.ok) throw new Error(`${kind}/${name} failed: ${json.error}`);
  return json.result;
}

const seed = (name: string, params?: unknown) => callControl('seed', name, params);
const action = (name: string, params?: unknown) => callControl('actions', name, params);

async function arm(name: string, params: unknown = {}) {
  const response = await fetch(`${control}/control/huntress/faults/${name}/arm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (response.status !== 200) throw new Error(`arm ${name} failed: ${await response.text()}`);
}

/** Reset both sides: emulator state, and the integration's cursor + alerts. */
async function resetBoth(settingsPatch: Record<string, unknown> = {}) {
  await fetch(`${control}/control/huntress/reset`, { method: 'POST' });
  await action('configure', {
    accountName: 'Acme MSP',
    accountSubdomain: 'acme',
    credentials: [{ key: API_KEY, secret: API_SECRET, escalationsWrite: true }],
  });
  await tenantTable('comments').where({ tenant: tenantId }).del();
  await tenantTable('comment_threads').where({ tenant: tenantId }).del().catch(() => undefined);
  await tenantTable('asset_associations').where({ tenant: tenantId }).del();
  await tenantTable('rmm_alerts').where({ tenant: tenantId }).del();
  await tenantTable('tickets').where({ tenant: tenantId }).del();
  await tenantTable('tenant_external_entity_mappings').where({ tenant: tenantId }).del();
  await tenantTable('rmm_organization_mappings')
    .where({ tenant: tenantId })
    .whereNot({ external_organization_id: String(MAPPED_ORG) })
    .del();
  await tenantTable('rmm_integrations')
    .where({ integration_id: integrationId })
    .update({
      instance_url: vendor,
      is_active: true,
      settings: JSON.stringify({ ...baseSettings, ...settingsPatch }),
      sync_status: 'pending',
      sync_error: null,
      last_incremental_sync_at: null,
    });
}

async function integrationRow() {
  const row = await tenantTable('rmm_integrations').where({ integration_id: integrationId }).first();
  return { ...row, parsed: parseHuntressSettings(row.settings) };
}

const poll = () => pollHuntressIncidents({ tenantId, integrationId, trigger: 'manual' });

async function seedOrgsAndAgent() {
  await seed('organization', { id: MAPPED_ORG, name: 'Acme Inc.', key: 'acme' });
  await seed('organization', { id: UNMAPPED_ORG, name: 'Globex Ltd.', key: 'globex' });
  await seed('agent', {
    id: AGENT_ID,
    hostname: 'SRV01',
    organization_id: MAPPED_ORG,
    platform: 'windows',
    os: 'Windows Server 2022',
    ipv4_address: '10.0.0.5',
    serial_number: 'SN-1',
  });
}

beforeAll(async () => {
  process.env.DB_PORT = process.env.DB_PORT || '5432';
  process.env.APP_ENV = process.env.APP_ENV || 'test';
  db = await createTestDbConnection();
  h.db = db;

  host = new EmulatorHost({ emulators: [huntress], controlPort: 0, ports: { huntress: 0 } });
  const started = await host.start();
  control = `http://127.0.0.1:${started.controlPort}`;
  vendor = `http://127.0.0.1:${started.ports.huntress}`;

  await tenantTable('tenants').insert({
    tenant: tenantId,
    ...((await hasColumn('tenants', 'company_name'))
      ? { company_name: 'Huntress Emulator Tenant' }
      : { client_name: 'Huntress Emulator Tenant' }),
    email: `huntress-poll-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await tenantTable('users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `huntress-poll-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `huntress-poll-user-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await tenantTable('clients').insert([
    {
      tenant: tenantId,
      client_id: clientId,
      client_name: 'Acme Corp',
      properties: JSON.stringify({ primary_contact_id: primaryContactId }),
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
    {
      tenant: tenantId,
      client_id: fallbackClientId,
      client_name: 'Internal (Unmapped Security)',
      properties: JSON.stringify({}),
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
  ]);

  const contactClientColumn = (await hasColumn('contacts', 'client_id')) ? 'client_id' : 'company_id';
  await tenantTable('contacts').insert([
    {
      tenant: tenantId,
      contact_name_id: primaryContactId,
      full_name: 'Acme Primary Contact',
      email: 'primary@example.com',
      [contactClientColumn]: clientId,
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
    {
      tenant: tenantId,
      contact_name_id: mappingDefaultContactId,
      full_name: 'Acme Mapping Contact',
      email: 'mapping@example.com',
      [contactClientColumn]: clientId,
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
  ]);

  // boards has no created_at/updated_at columns in the live schema.
  await tenantTable('boards').insert([
    { tenant: tenantId, board_id: securityBoardId, board_name: 'Security', is_default: false },
    { tenant: tenantId, board_id: triageBoardId, board_name: 'Security Triage', is_default: false },
  ]);

  // The live statuses schema has BOTH status_type (NOT NULL) and item_type.
  const statusItemType = {
    ...((await hasColumn('statuses', 'item_type')) ? { item_type: 'ticket' } : {}),
    ...((await hasColumn('statuses', 'status_type')) ? { status_type: 'ticket' } : {}),
  };
  await tenantTable('statuses').insert([
    {
      tenant: tenantId,
      status_id: statusOpenId,
      name: 'Open',
      ...statusItemType,
      is_closed: false,
      is_default: true,
      order_number: 10,
      created_by: userId,
    },
    {
      tenant: tenantId,
      status_id: statusClosedId,
      name: 'Closed',
      ...statusItemType,
      is_closed: true,
      is_default: false,
      order_number: 20,
      created_by: userId,
    },
  ]);

  await tenantTable('priorities').insert(
    [
      { id: pCritId, name: 'Critical', order: 1 },
      { id: pHighId, name: 'High', order: 2 },
      { id: pLowId, name: 'Medium', order: 3 },
    ].map((p) => ({
      tenant: tenantId,
      priority_id: p.id,
      priority_name: p.name,
      item_type: 'ticket',
      order_number: p.order,
      color: '#888888',
      created_by: userId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }))
  );

  await tenantTable('rmm_integrations').insert({
    tenant: tenantId,
    integration_id: integrationId,
    provider: 'huntress',
    instance_url: vendor,
    is_active: true,
    connected_at: db.fn.now(),
    settings: JSON.stringify(baseSettings),
  });

  // Org 500 is mapped to Acme; org 600 has no mapping row at all.
  await tenantTable('rmm_organization_mappings').insert({
    tenant: tenantId,
    mapping_id: uuidv4(),
    integration_id: integrationId,
    external_organization_id: String(MAPPED_ORG),
    external_organization_name: 'Acme Inc.',
    client_id: clientId,
    default_contact_id: mappingDefaultContactId,
    auto_sync_assets: false,
    auto_create_tickets: true,
  });

  await tenantTable('assets').insert({
    tenant: tenantId,
    asset_id: assetId,
    asset_type: 'workstation',
    name: 'SRV01',
    asset_tag: 'HT-1',
    serial_number: 'SN-1',
    // assets.status is NOT NULL with no default in the live schema.
    status: 'active',
    client_id: clientId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}, HOOK_TIMEOUT);

afterAll(async () => {
  if (host) await host.stop();
  if (!db) return;
  for (const table of [
    'comments',
    'comment_threads',
    'asset_associations',
    'rmm_alerts',
    'tickets',
    'tenant_external_entity_mappings',
    'rmm_organization_mappings',
    'rmm_integrations',
    'assets',
    'priorities',
    'statuses',
    'boards',
    'contacts',
    'clients',
    'users',
    'tenants',
  ]) {
    await tenantTable(table)
      .where({ tenant: tenantId })
      .del()
      .catch(() => undefined);
  }
  await db.destroy().catch(() => undefined);
}, HOOK_TIMEOUT);

describe('pollHuntressIncidents against the Huntress emulator', { shuffle: false }, () => {
  it(
    'first run collects only the backfill window and routes a mapped incident to its board',
    async () => {
      await resetBoth();
      await seedOrgsAndAgent();
      const fresh = (
        await seed('incident', {
          organization_id: MAPPED_ORG,
          agent_id: AGENT_ID,
          severity: 'high',
          subject: 'HIGH - Incident on SRV01',
          summary: 'Huntress detected a malicious scheduled task on this host.',
          indicator_types: ['footholds'],
        })
      ).incident_report;
      // Older than backfillDays: the cursor walk stops at it and never
      // processes it on a first run.
      const stale = (
        await seed('incident', {
          organization_id: MAPPED_ORG,
          agent_id: AGENT_ID,
          severity: 'low',
          subject: 'LOW - Ancient incident',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        })
      ).incident_report;

      const result = await poll();
      expect(result).toMatchObject({ success: true, processed: 1, failed: 0 });

      const alerts = await tenantTable('rmm_alerts').where({ tenant: tenantId }).select('external_alert_id');
      expect(alerts.map((a) => a.external_alert_id)).toEqual([String(fresh.id)]);
      expect(alerts.map((a) => a.external_alert_id)).not.toContain(String(stale.id));

      const alert = await tenantTable('rmm_alerts')
        .where({ tenant: tenantId, external_alert_id: String(fresh.id) })
        .first();
      expect(alert.severity).toBe('high');
      // The asset was matched by hostname through GET /v1/agents/7.
      expect(alert.asset_id).toBe(assetId);
      expect(alert.device_name).toBe('SRV01');

      const ticket = await tenantTable('tickets').where({ tenant: tenantId, ticket_id: alert.ticket_id }).first();
      expect(ticket.client_id).toBe(clientId);
      expect(ticket.board_id).toBe(securityBoardId);
      expect(ticket.priority_id).toBe(pHighId);
      expect(ticket.status_id).toBe(statusOpenId);
      expect(ticket.contact_name_id).toBe(mappingDefaultContactId);
      expect(ticket.attributes?.description ?? ticket.description).toContain('SRV01');
      expect(ticket.attributes?.description ?? ticket.description).toContain(
        `https://acme.huntress.io/incident_reports/${fresh.id}`
      );

      const row = await integrationRow();
      expect(row.sync_status).toBe('completed');
      expect(row.parsed.incidentCursor).toBe(fresh.updated_at);
      expect(row.last_incremental_sync_at).toBeTruthy();
    },
    TEST_TIMEOUT
  );

  it(
    'routes an unmapped organization to the fallback board and discovers its mapping row',
    async () => {
      await resetBoth();
      await seedOrgsAndAgent();
      const incident = (
        await seed('incident', {
          organization_id: UNMAPPED_ORG,
          severity: 'low',
          platform: 'microsoft_365',
          subject: 'LOW - M365 incident',
          indicator_types: ['managed_identity'],
        })
      ).incident_report;

      expect(await poll()).toMatchObject({ success: true, processed: 1 });

      const alert = await tenantTable('rmm_alerts')
        .where({ tenant: tenantId, external_alert_id: String(incident.id) })
        .first();
      const ticket = await tenantTable('tickets').where({ tenant: tenantId, ticket_id: alert.ticket_id }).first();
      expect(ticket.client_id).toBe(fallbackClientId);
      expect(ticket.board_id).toBe(triageBoardId);
      expect(ticket.priority_id).toBe(pLowId);
      expect(ticket.contact_name_id).toBeNull();
      expect(ticket.title).toContain('[Unmapped Org]');

      // Discovered on demand through GET /v1/organizations/600, so the mapping
      // screen shows the Huntress name rather than a placeholder.
      const discovered = await tenantTable('rmm_organization_mappings')
        .where({ tenant: tenantId, integration_id: integrationId, external_organization_id: String(UNMAPPED_ORG) })
        .first();
      expect(discovered.client_id).toBeNull();
      expect(discovered.external_organization_name).toBe('Globex Ltd.');
      expect(JSON.parse(JSON.stringify(discovered.metadata)).discoveredVia).toBe('incident_poll');
    },
    TEST_TIMEOUT
  );

  it(
    'notes a status change, closes the ticket when the incident closes, and skips an unchanged incident',
    async () => {
      await resetBoth();
      await seedOrgsAndAgent();
      const incident = (
        await seed('incident', {
          organization_id: MAPPED_ORG,
          agent_id: AGENT_ID,
          severity: 'critical',
          subject: 'CRITICAL - Incident on SRV01',
        })
      ).incident_report;
      expect(await poll()).toMatchObject({ processed: 1 });
      const alert = await tenantTable('rmm_alerts')
        .where({ tenant: tenantId, external_alert_id: String(incident.id) })
        .first();
      const notesAfterCreate = await tenantTable('comments')
        .where({ tenant: tenantId, ticket_id: alert.ticket_id })
        .count('* as n')
        .first();

      // Nothing changed in Huntress: the second poll re-collects the incident
      // inside the cursor overlap and plans `skip`.
      expect(await poll()).toMatchObject({ success: true, processed: 1 });
      expect(
        Number(
          (
            await tenantTable('comments')
              .where({ tenant: tenantId, ticket_id: alert.ticket_id })
              .count('* as n')
              .first()
          )?.n
        )
      ).toBe(Number(notesAfterCreate?.n));

      // A touch (same status, newer updated_at) is a real update: it notes.
      host.clock.advance('30m');
      await action('touch-incident', { incidentId: incident.id });
      expect(await poll()).toMatchObject({ success: true, processed: 1 });
      const notesAfterTouch = Number(
        (
          await tenantTable('comments')
            .where({ tenant: tenantId, ticket_id: alert.ticket_id })
            .count('* as n')
            .first()
        )?.n
      );
      expect(notesAfterTouch).toBe(Number(notesAfterCreate?.n) + 1);

      host.clock.advance('30m');
      await action('update-incident', { incidentId: incident.id, status: 'closed' });
      expect(await poll()).toMatchObject({ success: true, processed: 1 });

      const notesAfterClose = Number(
        (
          await tenantTable('comments')
            .where({ tenant: tenantId, ticket_id: alert.ticket_id })
            .count('* as n')
            .first()
        )?.n
      );
      expect(notesAfterClose).toBe(notesAfterTouch + 1);
      const ticket = await tenantTable('tickets').where({ tenant: tenantId, ticket_id: alert.ticket_id }).first();
      expect(ticket.status_id).toBe(statusClosedId);
      const closedAlert = await tenantTable('rmm_alerts').where({ alert_id: alert.alert_id }).first();
      expect(closedAlert.status).toBe('closed');
      expect(closedAlert.resolved_at).toBeTruthy();
    },
    TEST_TIMEOUT
  );

  it(
    'advances the cursor only past successes and records the failure',
    async () => {
      // The configured category row does not exist, and only a mapped-org
      // ticket carries a category (tickets_tenant_category_id_foreign), so the
      // middle incident fails its insert while its unmapped neighbours do not.
      await resetBoth({ categoryId: missingCategoryId });
      await seedOrgsAndAgent();
      const first = (
        await seed('incident', { organization_id: UNMAPPED_ORG, severity: 'low', subject: 'LOW - first' })
      ).incident_report;
      host.clock.advance('10m');
      const broken = (
        await seed('incident', { organization_id: MAPPED_ORG, severity: 'critical', subject: 'CRITICAL - breaks' })
      ).incident_report;
      host.clock.advance('10m');
      const third = (
        await seed('incident', { organization_id: UNMAPPED_ORG, severity: 'high', subject: 'HIGH - never reached' })
      ).incident_report;

      const result = await poll();
      expect(result.success).toBe(false);
      expect(result.processed).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.error).toBeTruthy();

      const row = await integrationRow();
      expect(row.sync_status).toBe('error');
      expect(row.sync_error).toBeTruthy();
      // The cursor stops at the last success, so the failed incident and
      // everything after it are retried next cycle.
      expect(row.parsed.incidentCursor).toBe(first.updated_at);

      const alerts = await tenantTable('rmm_alerts').where({ tenant: tenantId }).select('external_alert_id');
      expect(alerts.map((a) => a.external_alert_id)).toEqual([String(first.id)]);
      expect(alerts.map((a) => a.external_alert_id)).not.toContain(String(third.id));
      expect(alerts.map((a) => a.external_alert_id)).not.toContain(String(broken.id));
    },
    TEST_TIMEOUT
  );

  it(
    'leaves the cursor and last_incremental_sync_at untouched when the incident list fails',
    async () => {
      await resetBoth();
      await seedOrgsAndAgent();
      await seed('incident', { organization_id: MAPPED_ORG, severity: 'high', subject: 'HIGH - first' });
      expect(await poll()).toMatchObject({ success: true, processed: 1 });
      const before = await integrationRow();
      expect(before.parsed.incidentCursor).toBeTruthy();

      host.clock.advance('30m');
      await seed('incident', { organization_id: MAPPED_ORG, severity: 'high', subject: 'HIGH - unseen' });
      await arm('operation-fault', {
        operation: 'GET /v1/incident_reports',
        status: 503,
        message: 'Service Unavailable',
        remaining: 3,
      });

      const result = await poll();
      expect(result.success).toBe(false);
      expect(result.processed).toBe(0);
      expect(result.error).toContain('503');

      const after = await integrationRow();
      expect(after.sync_status).toBe('error');
      expect(after.parsed.incidentCursor).toBe(before.parsed.incidentCursor);
      expect(String(after.last_incremental_sync_at)).toBe(String(before.last_incremental_sync_at));
      expect(
        Number((await tenantTable('rmm_alerts').where({ tenant: tenantId }).count('* as n').first())?.n)
      ).toBe(1);
    },
    TEST_TIMEOUT
  );

  it(
    'retries a 429 and still completes the poll',
    async () => {
      await resetBoth();
      await seedOrgsAndAgent();
      const incident = (
        await seed('incident', {
          organization_id: MAPPED_ORG,
          agent_id: AGENT_ID,
          severity: 'high',
          subject: 'HIGH - rate limited',
        })
      ).incident_report;

      // One 429 with Retry-After: 1 on the first call of the cycle.
      await arm('rate-limit', { remaining: 1, retryAfterSeconds: 1 });
      const result = await poll();
      expect(result).toMatchObject({ success: true, processed: 1, failed: 0 });
      const alert = await tenantTable('rmm_alerts')
        .where({ tenant: tenantId, external_alert_id: String(incident.id) })
        .first();
      expect(alert.ticket_id).toBeTruthy();

      const journal = (await (await fetch(`${control}/control/huntress/requests`)).json()).result;
      expect(journal.requests.filter((r: { status: number }) => r.status === 429)).toHaveLength(1);
    },
    TEST_TIMEOUT
  );

  it(
    'falls back to HUNTRESS_API_BASE_URL when the tenant stored no instance_url',
    async () => {
      await resetBoth();
      await seedOrgsAndAgent();
      const incident = (
        await seed('incident', { organization_id: MAPPED_ORG, severity: 'low', subject: 'LOW - env routed' })
      ).incident_report;
      await tenantTable('rmm_integrations').where({ integration_id: integrationId }).update({ instance_url: null });
      process.env.HUNTRESS_API_BASE_URL = vendor;

      try {
        expect(await poll()).toMatchObject({ success: true, processed: 1 });
        const alert = await tenantTable('rmm_alerts')
          .where({ tenant: tenantId, external_alert_id: String(incident.id) })
          .first();
        expect(alert.ticket_id).toBeTruthy();
      } finally {
        delete process.env.HUNTRESS_API_BASE_URL;
        await tenantTable('rmm_integrations').where({ integration_id: integrationId }).update({ instance_url: vendor });
      }
    },
    TEST_TIMEOUT
  );
});
