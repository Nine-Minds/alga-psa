import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '@main-test-utils/dbConfig';
import { parseHuntressSettings } from '@ee/lib/integrations/huntress/settings';
import type {
  HuntressEscalation,
  HuntressIncidentReport,
} from '@ee/interfaces/huntress.interfaces';
import {
  processIncident,
  type ProcessIncidentDeps,
} from '@ee/lib/integrations/huntress/incidents/incidentProcessor';
import {
  processEscalation,
  type ProcessEscalationDeps,
} from '@ee/lib/integrations/huntress/escalations/escalationProcessor';

const HOOK_TIMEOUT = 180_000;

let db: Knex;

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
// A second mapped client that owns its own same-named "SRV01" asset — used to
// prove a multi-org escalation never links one client's ticket to another
// client's asset.
const clientBId = uuidv4();
const clientBAssetId = uuidv4();

const settings = parseHuntressSettings({
  accountSubdomain: 'acme',
  boardId: securityBoardId,
  fallbackClientId,
  fallbackBoardId: triageBoardId,
  severityPriorityMap: { critical: pCritId, high: pHighId, low: pLowId },
  autoCloseTickets: true,
  closedStatusId: statusClosedId,
});

const integration = { integration_id: integrationId, settings: { ...settings, ingestEscalations: true } };

const deps: ProcessIncidentDeps = {
  getAgent: async (id) =>
    id === 7
      ? {
          id: 7,
          hostname: 'SRV01',
          os: 'Windows Server 2022',
          ipv4_address: '10.0.0.5',
          external_ip: null,
          serial_number: 'SN-1',
          last_callback_at: null,
        }
      : null,
  getOrganization: async (id) => ({ id, name: `Discovered Org ${id}` }),
};

function incident(overrides: Partial<HuntressIncidentReport> = {}): HuntressIncidentReport {
  return {
    id: 1000,
    account_id: 1,
    agent_id: 7,
    organization_id: 500,
    subject: 'HIGH - Incident on SRV01',
    summary: 'Malicious task detected.',
    body: null,
    severity: 'high',
    status: 'sent',
    platform: 'windows',
    indicator_types: ['footholds'],
    indicator_counts: { footholds: 1 },
    sent_at: '2026-06-09T10:00:00Z',
    closed_at: null,
    status_updated_at: '2026-06-09T10:00:00Z',
    updated_at: '2026-06-09T10:00:00Z',
    ...overrides,
  };
}

const escalationDeps: ProcessEscalationDeps = {
  getEscalation: async (id) => ({
    ...escalation({ id }),
    entities: {
      total_count: 1,
      has_more: false,
      items: [{ id: 7, type: 'Agent', details: { hostname: 'SRV01', os: 'Windows Server 2022' } }],
    },
  }),
  getAgent: deps.getAgent,
  getOrganization: deps.getOrganization,
};

function escalation(overrides: Partial<HuntressEscalation> = {}): HuntressEscalation {
  return {
    id: 2000,
    organizations: [{ id: 500, name: 'Acme Corp' }],
    severity: 'critical',
    status: 'open',
    subject: 'Defender Disabled',
    type: 'Environmental Issue',
    type_code: 'defender_disabled',
    subtype: null,
    psa_ticket_eids: [],
    created_at: '2026-06-09T10:00:00Z',
    resolved_at: null,
    updated_at: '2026-06-09T10:00:00Z',
    ...overrides,
  };
}

async function alertsFor(escalationId: number) {
  return tenantTable('rmm_alerts')
    .where({ tenant: tenantId, integration_id: integrationId })
    .where('external_alert_id', 'like', `escalation:${escalationId}:org:%`)
    .orderBy('external_alert_id');
}

async function hasColumn(table: string, column: string): Promise<boolean> {
  return db.schema.hasColumn(table, column);
}

function tenantTable(table: string) {
  return tenantDb(db, tenantId).table(table);
}

beforeAll(async () => {
  process.env.DB_PORT = process.env.DB_PORT || '5432';
  process.env.APP_ENV = process.env.APP_ENV || 'test';
  db = await createTestDbConnection();

  await tenantTable('tenants').insert({
    tenant: tenantId,
    ...((await hasColumn('tenants', 'company_name'))
      ? { company_name: 'Huntress Test Tenant' }
      : { client_name: 'Huntress Test Tenant' }),
    email: `huntress-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await tenantTable('users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `huntress-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `huntress-user-${tenantId.slice(0, 8)}@example.com`,
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
      client_id: clientBId,
      client_name: 'Globex Corp',
      properties: JSON.stringify({}),
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
    {
      tenant: tenantId,
      board_id: securityBoardId,
      board_name: 'Security',
      is_default: false,
    },
    {
      tenant: tenantId,
      board_id: triageBoardId,
      board_name: 'Security Triage',
      is_default: false,
    },
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
    instance_url: 'https://api.huntress.io',
    is_active: true,
    connected_at: db.fn.now(),
    settings: JSON.stringify(settings),
  });

  // Org 500 is mapped to Acme; org 600 has no mapping row at all.
  await tenantTable('rmm_organization_mappings').insert([
    {
      tenant: tenantId,
      mapping_id: uuidv4(),
      integration_id: integrationId,
      external_organization_id: '500',
      external_organization_name: 'Acme Corp',
      client_id: clientId,
      default_contact_id: mappingDefaultContactId,
      auto_sync_assets: false,
      auto_create_tickets: true,
    },
    {
      tenant: tenantId,
      mapping_id: uuidv4(),
      integration_id: integrationId,
      external_organization_id: '700',
      external_organization_name: 'Globex Corp',
      client_id: clientBId,
      auto_sync_assets: false,
      auto_create_tickets: true,
    },
  ]);

  await tenantTable('assets').insert(
    [
      { asset_id: assetId, tag: 'HT-1', client_id: clientId },
      { asset_id: clientBAssetId, tag: 'HT-2', client_id: clientBId },
    ].map((a) => ({
      tenant: tenantId,
      asset_id: a.asset_id,
      asset_type: 'workstation',
      name: 'SRV01',
      asset_tag: a.tag,
      serial_number: 'SN-1',
      // assets.status is NOT NULL with no default in the live schema.
      status: 'active',
      client_id: a.client_id,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }))
  );
}, HOOK_TIMEOUT);

afterAll(async () => {
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
    // Every table here, including tenant_external_entity_mappings, uses a
    // `tenant` column in the live schema.
    await tenantTable(table)
      .where({ tenant: tenantId })
      .del()
      .catch(() => undefined);
  }
  await db.destroy().catch(() => undefined);
}, HOOK_TIMEOUT);

// The lifecycle scenarios build on each other (create → reprocess → close),
// so opt this suite out of the config-level test shuffling.
describe('processEscalation (DB integration)', { shuffle: false }, () => {
  it('creates a routed, asset-linked ticket for a single-org escalation', async () => {
    const result = await processEscalation(db, tenantId, integration, escalation(), escalationDeps);
    expect(result.ok).toBe(true);
    expect(result.targets).toEqual([
      expect.objectContaining({ externalAlertId: 'escalation:2000:org:500', action: 'create_ticket' }),
    ]);

    const [alert] = await alertsFor(2000);
    expect(alert.source_type).toBe('escalation');
    expect(alert.alert_class).toBe('defender_disabled');
    expect(alert.asset_id).toBe(assetId);
    expect(alert.device_name).toBe('SRV01');

    const ticket = await tenantTable('tickets').where({ tenant: tenantId, ticket_id: alert.ticket_id }).first();
    expect(ticket.client_id).toBe(clientId);
    expect(ticket.board_id).toBe(securityBoardId);
    expect(ticket.priority_id).toBe(pCritId);
    expect(ticket.contact_name_id).toBe(mappingDefaultContactId);
    expect(ticket.title).toBe('[Huntress Escalation] Defender Disabled');
    const attributes = typeof ticket.attributes === 'string' ? JSON.parse(ticket.attributes) : ticket.attributes;
    expect(attributes.description).toContain('**Hostname:** SRV01');
    expect(attributes.description).toContain('https://acme.huntress.io/account/escalations/2000');
  });

  it('is idempotent — reprocessing the unchanged escalation creates nothing new', async () => {
    const before = await tenantTable('tickets').where({ tenant: tenantId }).count('* as n').first();
    const result = await processEscalation(db, tenantId, integration, escalation(), escalationDeps);
    expect(result.targets.map((t) => t.action)).toEqual(['skip']);
    const after = await tenantTable('tickets').where({ tenant: tenantId }).count('* as n').first();
    expect(Number(after?.n)).toBe(Number(before?.n));
  });

  it('notes overdue, then closes the ticket when the escalation resolves', async () => {
    const overdue = await processEscalation(
      db, tenantId, integration,
      escalation({ status: 'overdue', updated_at: '2026-06-10T10:00:00Z' }),
      escalationDeps
    );
    expect(overdue.targets.map((t) => t.action)).toEqual(['append_note']);

    await processEscalation(
      db, tenantId, integration,
      escalation({ status: 'resolved', resolved_at: '2026-06-11T10:00:00Z', updated_at: '2026-06-11T10:00:00Z' }),
      escalationDeps
    );
    const [alert] = await alertsFor(2000);
    const ticket = await tenantTable('tickets').where({ tenant: tenantId, ticket_id: alert.ticket_id }).first();
    expect(ticket.status_id).toBe(statusClosedId);
    const notes = await tenantTable('comments').where({ tenant: tenantId, ticket_id: alert.ticket_id });
    expect(notes.some((n: any) => String(n.note).includes('open → overdue'))).toBe(true);
    expect(notes.some((n: any) => String(n.note).includes('overdue → resolved'))).toBe(true);
  });

  it('coexists with an incident that has the same numeric id', async () => {
    const inc = await processIncident(db, tenantId, integration, incident({ id: 4000 }), deps);
    const esc = await processEscalation(db, tenantId, integration, escalation({ id: 4000 }), escalationDeps);
    expect(inc.action).toBe('create_ticket');
    expect(esc.targets.map((t) => t.action)).toEqual(['create_ticket']);
    expect(inc.ticketId).not.toBe(esc.targets[0].ticketId);
  });

  it('creates one ticket per org on a multi-org escalation without cross-client asset links', async () => {
    const multi = escalation({
      id: 3000,
      organizations: [
        { id: 500, name: 'Acme Corp' },
        { id: 700, name: 'Globex Corp' },
        { id: 800, name: 'Initech' },
      ],
    });
    const result = await processEscalation(db, tenantId, integration, multi, escalationDeps);
    expect(result.ok).toBe(true);
    expect(result.targets.map((t) => t.action)).toEqual(['create_ticket', 'create_ticket', 'create_ticket']);

    const alerts = await alertsFor(3000);
    expect(alerts.map((a: any) => a.external_alert_id)).toEqual([
      'escalation:3000:org:500',
      'escalation:3000:org:700',
      'escalation:3000:org:800',
    ]);
    // One host on a multi-org escalation can't be attributed to an org.
    expect(alerts.every((a: any) => a.asset_id === null && a.device_name === null)).toBe(true);

    const tickets = await tenantTable('tickets')
      .where({ tenant: tenantId })
      .whereIn('ticket_id', alerts.map((a: any) => a.ticket_id));
    const byClient = new Map(tickets.map((t: any) => [t.client_id, t]));
    expect(byClient.get(clientId)?.board_id).toBe(securityBoardId);
    expect(byClient.get(clientBId)?.board_id).toBe(securityBoardId);
    expect(byClient.get(fallbackClientId)?.board_id).toBe(triageBoardId);

    const globex = byClient.get(clientBId) as any;
    const globexBody = (typeof globex.attributes === 'string' ? JSON.parse(globex.attributes) : globex.attributes).description;
    expect(globexBody).toContain('**Huntress Organization:** Globex Corp');
    expect(globexBody).not.toContain('Acme Corp');
    expect(globexBody).not.toContain('Initech');

    const links = await tenantTable('asset_associations').where({ tenant: tenantId, asset_id: clientBAssetId });
    expect(links).toHaveLength(0);

    // Org 800 had no mapping row: it was discovered on demand.
    const discovered = await tenantTable('rmm_organization_mappings')
      .where({ tenant: tenantId, integration_id: integrationId, external_organization_id: '800' })
      .first();
    expect(discovered?.client_id).toBeNull();
  });

  it('still closes tickets for orgs that dropped off the escalation', async () => {
    const result = await processEscalation(
      db, tenantId, integration,
      escalation({
        id: 3000,
        organizations: [{ id: 500, name: 'Acme Corp' }],
        status: 'resolved',
        resolved_at: '2026-06-12T10:00:00Z',
        updated_at: '2026-06-12T10:00:00Z',
      }),
      escalationDeps
    );
    expect(result.ok).toBe(true);
    expect(result.targets.map((t) => t.action)).toEqual(['append_note', 'append_note', 'append_note']);

    const alerts = await alertsFor(3000);
    const tickets = await tenantTable('tickets')
      .where({ tenant: tenantId })
      .whereIn('ticket_id', alerts.map((a: any) => a.ticket_id));
    expect(tickets.every((t: any) => t.status_id === statusClosedId)).toBe(true);
    expect(alerts.every((a: any) => a.status === 'resolved')).toBe(true);
  });

  it('does not open a fallback ticket when an escalation loses its last organization', async () => {
    const created = await processEscalation(
      db, tenantId, integration, escalation({ id: 5000 }), escalationDeps
    );
    expect(created.targets.map((t) => t.action)).toEqual(['create_ticket']);
    const ticketsBefore = await tenantTable('tickets').where({ tenant: tenantId }).count('* as n').first();

    // Huntress now returns the escalation with no organizations.
    const overdue = await processEscalation(
      db, tenantId, integration,
      escalation({ id: 5000, organizations: [], status: 'overdue', updated_at: '2026-06-10T10:00:00Z' }),
      escalationDeps
    );
    expect(overdue.ok).toBe(true);
    expect(overdue.targets).toEqual([
      expect.objectContaining({ externalAlertId: 'escalation:5000:org:500', action: 'append_note' }),
    ]);
    const ticketsAfter = await tenantTable('tickets').where({ tenant: tenantId }).count('* as n').first();
    expect(Number(ticketsAfter?.n)).toBe(Number(ticketsBefore?.n));

    await processEscalation(
      db, tenantId, integration,
      escalation({
        id: 5000,
        organizations: [],
        status: 'resolved',
        resolved_at: '2026-06-11T10:00:00Z',
        updated_at: '2026-06-11T10:00:00Z',
      }),
      escalationDeps
    );
    const alerts = await alertsFor(5000);
    expect(alerts.map((a: any) => a.external_alert_id)).toEqual(['escalation:5000:org:500']);
    const ticket = await tenantTable('tickets').where({ tenant: tenantId, ticket_id: alerts[0].ticket_id }).first();
    expect(ticket.status_id).toBe(statusClosedId);
  });

  it('still uses the fallback placeholder for an escalation that never named an organization', async () => {
    const result = await processEscalation(
      db, tenantId, integration, escalation({ id: 6000, organizations: [] }), escalationDeps
    );
    expect(result.targets).toEqual([
      expect.objectContaining({ externalAlertId: 'escalation:6000:org:none', action: 'create_ticket' }),
    ]);
    const [alert] = await alertsFor(6000);
    const ticket = await tenantTable('tickets').where({ tenant: tenantId, ticket_id: alert.ticket_id }).first();
    expect(ticket.client_id).toBe(fallbackClientId);
    expect(ticket.board_id).toBe(triageBoardId);

    // Reprocessing it with a change updates the same placeholder row.
    const update = await processEscalation(
      db, tenantId, integration,
      escalation({ id: 6000, organizations: [], status: 'overdue', updated_at: '2026-06-10T10:00:00Z' }),
      escalationDeps
    );
    expect(update.targets).toEqual([
      expect.objectContaining({ externalAlertId: 'escalation:6000:org:none', action: 'append_note' }),
    ]);
  });
});
