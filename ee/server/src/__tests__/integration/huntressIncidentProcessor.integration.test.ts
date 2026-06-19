import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '@main-test-utils/dbConfig';
import { parseHuntressSettings } from '@ee/lib/integrations/huntress/settings';
import type { HuntressIncidentReport } from '@ee/interfaces/huntress.interfaces';
import {
  processIncident,
  type ProcessIncidentDeps,
} from '@ee/lib/integrations/huntress/incidents/incidentProcessor';
import { createHuntressTicket } from '@ee/lib/integrations/huntress/incidents/ticketCreator';

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

const settings = parseHuntressSettings({
  accountSubdomain: 'acme',
  boardId: securityBoardId,
  fallbackClientId,
  fallbackBoardId: triageBoardId,
  severityPriorityMap: { critical: pCritId, high: pHighId, low: pLowId },
  autoCloseTickets: true,
  closedStatusId: statusClosedId,
});

const integration = { integration_id: integrationId, settings };

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

async function hasColumn(table: string, column: string): Promise<boolean> {
  return db.schema.hasColumn(table, column);
}

beforeAll(async () => {
  process.env.DB_PORT = process.env.DB_PORT || '5432';
  process.env.APP_ENV = process.env.APP_ENV || 'test';
  db = await createTestDbConnection();

  await db('tenants').insert({
    tenant: tenantId,
    ...((await hasColumn('tenants', 'company_name'))
      ? { company_name: 'Huntress Test Tenant' }
      : { client_name: 'Huntress Test Tenant' }),
    email: `huntress-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `huntress-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `huntress-user-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('clients').insert([
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
  await db('contacts').insert([
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
  await db('boards').insert([
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
  await db('statuses').insert([
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

  await db('priorities').insert(
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

  await db('rmm_integrations').insert({
    tenant: tenantId,
    integration_id: integrationId,
    provider: 'huntress',
    instance_url: 'https://api.huntress.io',
    is_active: true,
    connected_at: db.fn.now(),
    settings: JSON.stringify(settings),
  });

  // Org 500 is mapped to Acme; org 600 has no mapping row at all.
  await db('rmm_organization_mappings').insert({
    tenant: tenantId,
    mapping_id: uuidv4(),
    integration_id: integrationId,
    external_organization_id: '500',
    external_organization_name: 'Acme Corp',
    client_id: clientId,
    default_contact_id: mappingDefaultContactId,
    auto_sync_assets: false,
    auto_create_tickets: true,
  });

  await db('assets').insert({
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
    await db(table)
      .where({ tenant: tenantId })
      .del()
      .catch(() => undefined);
  }
  await db.destroy().catch(() => undefined);
}, HOOK_TIMEOUT);

// The lifecycle scenarios build on each other (create → reprocess → close),
// so opt this suite out of the config-level test shuffling.
describe('processIncident (DB integration)', { shuffle: false }, () => {
  it('creates direct Huntress tickets with mapping default or client-default contacts', async () => {
    const mappingTicket = await db.transaction((trx) =>
      createHuntressTicket(trx, tenantId, {
        clientId,
        boardId: securityBoardId,
        priorityId: pHighId,
        title: 'Direct mapping contact',
        body: 'Direct body',
        note: 'Direct note',
        sourceReference: 'direct-mapping-contact',
        defaultContactId: mappingDefaultContactId,
      }),
    );
    const mappingRow = await db('tickets')
      .where({ tenant: tenantId, ticket_id: mappingTicket.ticket_id })
      .first();
    expect(mappingRow.contact_name_id).toBe(mappingDefaultContactId);

    const fallbackTicket = await db.transaction((trx) =>
      createHuntressTicket(trx, tenantId, {
        clientId,
        boardId: securityBoardId,
        title: 'Direct primary contact',
        body: 'Direct body',
        note: 'Direct note',
        sourceReference: 'direct-primary-contact',
      }),
    );
    const fallbackRow = await db('tickets')
      .where({ tenant: tenantId, ticket_id: fallbackTicket.ticket_id })
      .first();
    expect(fallbackRow.contact_name_id).toBe(primaryContactId);
  });

  it('creates a routed, self-contained ticket for a new mapped incident', async () => {
    const result = await processIncident(db, tenantId, integration, incident(), deps);
    expect(result.ok).toBe(true);
    expect(result.action).toBe('create_ticket');

    const alert = await db('rmm_alerts')
      .where({ tenant: tenantId, integration_id: integrationId, external_alert_id: '1000' })
      .first();
    expect(alert).toBeTruthy();
    expect(alert.ticket_id).toBeTruthy();
    expect(alert.severity).toBe('high');
    expect(alert.asset_id).toBe(assetId);

    const ticket = await db('tickets')
      .where({ tenant: tenantId, ticket_id: alert.ticket_id })
      .first();
    expect(ticket.client_id).toBe(clientId);
    expect(ticket.contact_name_id).toBe(mappingDefaultContactId);
    expect(ticket.board_id).toBe(securityBoardId);
    expect(ticket.priority_id).toBe(pHighId);
    expect(ticket.status_id).toBe(statusOpenId);
    expect(ticket.source).toBe('huntress');
    // The live tickets schema has no source_reference column; provenance is
    // pinned in the attributes JSONB.
    expect(ticket.attributes?.source_reference ?? ticket.source_reference).toBe('1000');
    expect(ticket.title).toContain('[Huntress]');
    expect(ticket.attributes?.description ?? ticket.description).toContain('SRV01');
    expect(ticket.attributes?.description ?? ticket.description).toContain(
      'https://acme.huntress.io/incident_reports/1000'
    );

    const association = await db('asset_associations')
      .where({ tenant: tenantId, asset_id: assetId, entity_id: alert.ticket_id })
      .first();
    expect(association).toBeTruthy();

    const note = await db('comments')
      .where({ tenant: tenantId, ticket_id: alert.ticket_id })
      .first();
    expect(note).toBeTruthy();

    const entityMapping = await db('tenant_external_entity_mappings')
      .where({ tenant: tenantId, integration_type: 'huntress', external_entity_id: '7' })
      .first();
    expect(entityMapping?.alga_entity_id).toBe(assetId);
  });

  it('is idempotent — reprocessing the unchanged incident creates nothing new', async () => {
    const before = await db('tickets').where({ tenant: tenantId }).count('* as n').first();
    const result = await processIncident(db, tenantId, integration, incident(), deps);
    expect(result.ok).toBe(true);
    expect(result.action).toBe('skip');
    const after = await db('tickets').where({ tenant: tenantId }).count('* as n').first();
    expect(Number(after?.n)).toBe(Number(before?.n));
  });

  it('appends a note and auto-closes when the incident closes', async () => {
    const alert = await db('rmm_alerts')
      .where({ tenant: tenantId, external_alert_id: '1000' })
      .first();
    const notesBefore = await db('comments')
      .where({ tenant: tenantId, ticket_id: alert.ticket_id })
      .count('* as n')
      .first();

    const result = await processIncident(
      db,
      tenantId,
      integration,
      incident({ status: 'closed', closed_at: '2026-06-09T12:00:00Z', updated_at: '2026-06-09T12:00:00Z' }),
      deps
    );
    expect(result.ok).toBe(true);
    expect(result.action).toBe('append_note');

    const notesAfter = await db('comments')
      .where({ tenant: tenantId, ticket_id: alert.ticket_id })
      .count('* as n')
      .first();
    expect(Number(notesAfter?.n)).toBe(Number(notesBefore?.n) + 1);

    const ticket = await db('tickets')
      .where({ tenant: tenantId, ticket_id: alert.ticket_id })
      .first();
    expect(ticket.status_id).toBe(statusClosedId);
  });

  it('routes an unknown org to the fallback client and discovers the mapping row', async () => {
    const result = await processIncident(
      db,
      tenantId,
      integration,
      incident({ id: 2000, organization_id: 600, agent_id: null, subject: 'LOW - M365 incident' }),
      deps
    );
    expect(result.ok).toBe(true);
    expect(result.action).toBe('create_ticket');

    const alert = await db('rmm_alerts')
      .where({ tenant: tenantId, external_alert_id: '2000' })
      .first();
    const ticket = await db('tickets')
      .where({ tenant: tenantId, ticket_id: alert.ticket_id })
      .first();
    expect(ticket.client_id).toBe(fallbackClientId);
    expect(ticket.contact_name_id).toBeNull();
    expect(ticket.board_id).toBe(triageBoardId);
    expect(ticket.title).toContain('[Unmapped Org]');

    const discovered = await db('rmm_organization_mappings')
      .where({ tenant: tenantId, integration_id: integrationId, external_organization_id: '600' })
      .first();
    expect(discovered).toBeTruthy();
    expect(discovered.client_id).toBeNull();
    expect(discovered.external_organization_name).toBe('Discovered Org 600');
  });

  it('records without a ticket when the mapping row opted out', async () => {
    await db('rmm_organization_mappings')
      .where({ tenant: tenantId, integration_id: integrationId, external_organization_id: '600' })
      .update({ auto_create_tickets: false });

    const result = await processIncident(
      db,
      tenantId,
      integration,
      incident({ id: 3000, organization_id: 600, agent_id: null }),
      deps
    );
    expect(result.ok).toBe(true);
    expect(result.action).toBe('record_only');

    const alert = await db('rmm_alerts')
      .where({ tenant: tenantId, external_alert_id: '3000' })
      .first();
    expect(alert).toBeTruthy();
    expect(alert.ticket_id).toBeNull();
  });
});
