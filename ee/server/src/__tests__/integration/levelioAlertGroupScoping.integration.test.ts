/**
 * Level.io alert → group-scoped rule integration coverage.
 *
 * Reproduces the filed-ticket shape: an active rule scoped to a Level group id
 * with keyword matching + createTicket + autoResolveTicket, a mapped Level
 * device whose device mapping carries the sync-engine canonicalized realm id,
 * and Level's real copied-automation payload (event/alert_id/device_id/
 * hostname/name/severity/description — NO group_id).
 *
 * The events fed to processRmmAlertEvent below mirror exactly what the EE
 * webhook handler produces after resolveLevelIoWebhookOrganization backfills
 * externalOrganizationId from the device mapping's external_realm_id (the
 * precedence chain is unit-tested in levelioWebhookOrganization.test.ts).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '@main-test-utils/dbConfig';
import { processRmmAlertEvent, type NormalizedRmmAlertEvent } from '@alga-psa/shared/rmm/alerts';

const HOOK_TIMEOUT = 180_000;

let db: Knex;

const tenantId = uuidv4();
const userId = uuidv4();
const clientA = uuidv4();
const clientB = uuidv4();
const boardId = uuidv4();
const statusOpenId = uuidv4();
const statusClosedId = uuidv4();
const integrationId = uuidv4();
const assetId = uuidv4();

const GROUP_1 = 'level-group-1'; // mapped → clientA, has the active rule
const GROUP_2 = 'level-group-2'; // mapped → clientB, no rule references it
const DEVICE_1 = 'level-dev-1';
const CONDITION = 'CPU';

function tenantTable(table: string) {
  return tenantDb(db, tenantId).table(table);
}

async function hasColumn(table: string, column: string): Promise<boolean> {
  return db.schema.hasColumn(table, column);
}

/** Mirrors the normalized event the EE route builds from a Level payload. */
function levelEvent(overrides: Partial<NormalizedRmmAlertEvent> = {}): NormalizedRmmAlertEvent {
  return {
    tenantId,
    integrationId,
    provider: 'levelio',
    kind: 'triggered',
    externalAlertId: `lvl-${uuidv4().slice(0, 8)}`,
    externalDeviceId: DEVICE_1,
    conditionIdentity: CONDITION,
    activityType: 'levelio_webhook',
    alertClass: 'CPU',
    sourceType: 'levelio_webhook',
    severity: 'major',
    message: 'CPU: usage is above threshold',
    deviceName: 'WS-01',
    externalOrganizationId: GROUP_1,
    occurredAt: new Date().toISOString(),
    raw: {
      event: 'alert.triggered',
      alert_id: 'lv-disk-1',
      device_id: DEVICE_1,
      hostname: 'WS-01',
      name: 'CPU',
      severity: 'critical',
      description: 'usage is above threshold',
    },
    ...overrides,
  };
}

async function countTickets(): Promise<number> {
  const row = await tenantTable('tickets').where({ tenant: tenantId }).count('ticket_id as n').first();
  return Number(row?.n ?? 0);
}

beforeAll(async () => {
  process.env.DB_PORT = process.env.DB_PORT || '5432';
  process.env.APP_ENV = process.env.APP_ENV || 'test';
  db = await createTestDbConnection();

  await tenantTable('tenants').insert({
    tenant: tenantId,
    ...((await hasColumn('tenants', 'company_name'))
      ? { company_name: 'LevelIO Group Scoping Test Tenant' }
      : { client_name: 'LevelIO Group Scoping Test Tenant' }),
    email: `levelio-group-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await tenantTable('users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `levelio-group-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `levelio-user-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await tenantTable('clients').insert([
    {
      tenant: tenantId,
      client_id: clientA,
      client_name: 'Acme Corp',
      properties: JSON.stringify({}),
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
    {
      tenant: tenantId,
      client_id: clientB,
      client_name: 'Beta Inc',
      properties: JSON.stringify({}),
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
  ]);

  await tenantTable('boards').insert({
    tenant: tenantId,
    board_id: boardId,
    board_name: 'Alerts',
    is_default: true,
  });

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
      board_id: boardId,
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
      board_id: boardId,
      is_closed: true,
      is_default: false,
      order_number: 20,
      created_by: userId,
    },
  ]);

  await tenantTable('rmm_integrations').insert({
    tenant: tenantId,
    integration_id: integrationId,
    provider: 'levelio',
    instance_url: 'https://api.level.io',
    is_active: true,
    connected_at: db.fn.now(),
    settings: JSON.stringify({}),
  });

  await tenantTable('rmm_organization_mappings').insert([
    {
      tenant: tenantId,
      mapping_id: uuidv4(),
      integration_id: integrationId,
      external_organization_id: GROUP_1,
      external_organization_name: 'Acme Corp',
      client_id: clientA,
      default_contact_id: null,
      auto_sync_assets: true,
      auto_create_tickets: false,
    },
    {
      tenant: tenantId,
      mapping_id: uuidv4(),
      integration_id: integrationId,
      external_organization_id: GROUP_2,
      external_organization_name: 'Beta Inc',
      client_id: clientB,
      default_contact_id: null,
      auto_sync_assets: true,
      auto_create_tickets: false,
    },
  ]);

  await tenantTable('assets').insert({
    tenant: tenantId,
    asset_id: assetId,
    asset_type: 'server',
    name: 'WS-01',
    asset_tag: 'levelio:level-dev-1',
    serial_number: 'SN-L1',
    status: 'active',
    client_id: clientA,
    rmm_provider: 'levelio',
    rmm_device_id: DEVICE_1,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  // Mapped Level device: external_realm_id is the sync-engine canonicalized
  // (deepest-mapped) group — the value the webhook handler uses to backfill
  // externalOrganizationId for payloads without group_id.
  await tenantTable('tenant_external_entity_mappings').insert({
    tenant: tenantId,
    id: uuidv4(),
    integration_type: 'levelio',
    alga_entity_type: 'asset',
    alga_entity_id: assetId,
    external_entity_id: DEVICE_1,
    external_realm_id: GROUP_1,
    sync_status: 'synced',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  // FTS shape: group + keyword scoped rule that creates and auto-resolves.
  await tenantTable('rmm_alert_rules').insert({
    tenant: tenantId,
    rule_id: uuidv4(),
    integration_id: integrationId,
    name: 'Group-1 CPU alerts',
    is_active: true,
    priority_order: 0,
    conditions: JSON.stringify({
      keywords: ['cpu'],
      organizationIds: [GROUP_1],
    }),
    actions: JSON.stringify({
      createTicket: true,
      boardId,
      autoResolveTicket: true,
    }),
  });
}, HOOK_TIMEOUT);

afterAll(async () => {
  if (!db) return;
  for (const table of [
    'comments',
    'comment_threads',
    'asset_associations',
    'rmm_alerts',
    'rmm_alert_rules',
    'rmm_maintenance_windows',
    'tickets',
    'next_number',
    'tenant_external_entity_mappings',
    'rmm_organization_mappings',
    'rmm_integrations',
    'assets',
    'statuses',
    'boards',
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

describe('Level.io group-scoped alert rules (DB integration)', { shuffle: false }, () => {
  let cpuTicketId: string;
  let cpuAlertId: string;

  it('creates exactly one ticket for a copied payload (no group_id) backed by the device realm group', async () => {
    const before = await countTickets();

    // Payload has NO group_id; the handler would have backfilled the org from
    // the device mapping realm (GROUP_1). Keyword + org both match.
    const result = await processRmmAlertEvent(
      { knex: db },
      levelEvent({ externalAlertId: 'lv-disk-1' })
    );

    expect(result.outcome).toBe('ticket_created');
    expect(result.matchedRuleId).toBeDefined();
    cpuTicketId = result.ticketId!;
    cpuAlertId = result.alertId!;
    expect(await countTickets()).toBe(before + 1);

    const alert = await tenantTable('rmm_alerts')
      .where({ tenant: tenantId, external_alert_id: 'lv-disk-1' })
      .first();
    expect(alert.status).toBe('active');
    expect(alert.asset_id).toBe(assetId);
    expect(alert.matched_rule_id).toBeDefined();
    expect(alert.metadata).toMatchObject({
      event: 'alert.triggered',
      device_id: DEVICE_1,
      name: 'CPU',
    });
    expect(alert.metadata.group_id).toBeUndefined();

    const ticket = await tenantTable('tickets').where({ tenant: tenantId, ticket_id: cpuTicketId }).first();
    expect(ticket.client_id).toBe(clientA); // correct tenant/client
    expect(ticket.source).toBe('levelio');
    expect(ticket.board_id).toBe(boardId);
  });

  it('a replayed delivery of the same alert_id is a no-op (no duplicate tickets)', async () => {
    const before = await countTickets();
    const result = await processRmmAlertEvent({ knex: db }, levelEvent({ externalAlertId: 'lv-disk-1' }));
    expect(result.outcome).toBe('skipped');
    expect(await countTickets()).toBe(before);

    const rows = await tenantTable('rmm_alerts')
      .where({ tenant: tenantId, external_alert_id: 'lv-disk-1' });
    expect(rows).toHaveLength(1);
  });

  it('a repeat firing of the same (device, condition) appends to the open ticket', async () => {
    const before = await countTickets();
    const result = await processRmmAlertEvent({ knex: db }, levelEvent({ externalAlertId: 'lv-disk-2' }));
    expect(result.outcome).toBe('occurrence_appended');
    expect(result.ticketId).toBe(cpuTicketId);
    expect(await countTickets()).toBe(before);

    const original = await tenantTable('rmm_alerts').where({ tenant: tenantId, alert_id: cpuAlertId }).first();
    expect(Number(original.occurrence_count)).toBe(2);
  });

  it('a group-scoped rule does NOT broaden: a mapped-but-unruled group stays unticketed', async () => {
    const before = await countTickets();

    // GROUP_2 is mapped to clientB but no rule references it; keyword matches.
    // Group-scoped rules must not broaden — this records without a ticket.
    const result = await processRmmAlertEvent(
      { knex: db },
      levelEvent({ externalAlertId: 'lv-other-org', externalOrganizationId: GROUP_2 })
    );

    expect(result.outcome).toBe('recorded_only');
    expect(await countTickets()).toBe(before);

    const alert = await tenantTable('rmm_alerts')
      .where({ tenant: tenantId, external_alert_id: 'lv-other-org' })
      .first();
    expect(alert.ticket_id).toBeNull();
    expect(alert.matched_rule_id).toBeNull();
  });

  it('keyword mismatch records without a ticket even for the matching group', async () => {
    const before = await countTickets();
    const result = await processRmmAlertEvent(
      { knex: db },
      levelEvent({
        externalAlertId: 'lv-no-keyword',
        externalDeviceId: 'level-dev-unknown-1',
        externalOrganizationId: GROUP_1,
        message: 'nothing relevant here',
        raw: { event: 'alert.triggered', alert_id: 'lv-no-keyword', device_id: 'x', name: 'Other', severity: 'information' },
      })
    );
    expect(result.outcome).toBe('recorded_only');
    expect(await countTickets()).toBe(before);
  });

  it('unknown device + unresolved org records without a ticket (no broadening)', async () => {
    const before = await countTickets();
    const result = await processRmmAlertEvent(
      { knex: db },
      levelEvent({
        externalAlertId: 'lv-unknown-device',
        externalDeviceId: 'level-dev-ghost',
        externalOrganizationId: null,
      })
    );
    expect(result.outcome).toBe('recorded_only');
    expect(await countTickets()).toBe(before);
  });

  it('an explicit group in the payload matches even without a mapped device (client from org mapping)', async () => {
    const before = await countTickets();

    // Copied payloads may later include group_id; precedence (a) must win and,
    // with no asset, the org mapping supplies the client.
    const result = await processRmmAlertEvent(
      { knex: db },
      levelEvent({
        externalAlertId: 'lv-explicit-group',
        externalDeviceId: 'level-dev-9',
        conditionIdentity: 'MEMORY',
        alertClass: 'MEMORY',
        externalOrganizationId: GROUP_1,
        raw: { group_id: GROUP_1 },
      })
    );

    expect(result.outcome).toBe('ticket_created');
    expect(await countTickets()).toBe(before + 1);

    const ticket = await tenantTable('tickets').where({ tenant: tenantId, ticket_id: result.ticketId! }).first();
    expect(ticket.client_id).toBe(clientA);
  });

  it('reset auto-resolves the untouched ticket and a later firing opens a new one', async () => {
    const result = await processRmmAlertEvent(
      { knex: db },
      levelEvent({ externalAlertId: 'lv-disk-1', kind: 'reset' })
    );
    expect(result.outcome).toBe('resolved');

    const alert = await tenantTable('rmm_alerts')
      .where({ tenant: tenantId, alert_id: cpuAlertId })
      .first();
    expect(alert.status).toBe('auto_resolved');
    expect(alert.resolved_at).not.toBeNull();

    const ticket = await tenantTable('tickets').where({ tenant: tenantId, ticket_id: cpuTicketId }).first();
    expect(ticket.status_id).toBe(statusClosedId);

    // New firing of the same condition after close creates a fresh ticket.
    const before = await countTickets();
    const refire = await processRmmAlertEvent(
      { knex: db },
      levelEvent({ externalAlertId: 'lv-disk-3' })
    );
    expect(refire.outcome).toBe('ticket_created');
    expect(refire.ticketId).not.toBe(cpuTicketId);
    expect(await countTickets()).toBe(before + 1);
  });
});
