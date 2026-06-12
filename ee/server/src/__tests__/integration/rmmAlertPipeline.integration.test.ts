import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '@main-test-utils/dbConfig';
import {
  processRmmAlertEvent,
  type NormalizedRmmAlertEvent,
} from '@alga-psa/shared/rmm/alerts';

const HOOK_TIMEOUT = 180_000;

let db: Knex;

// Fixture ids
const tenantId = uuidv4();
const userId = uuidv4();
const clientId = uuidv4();
const orgOnlyClientId = uuidv4();
const boardId = uuidv4();
const defaultBoardId = uuidv4();
const statusOpenId = uuidv4();
const statusClosedId = uuidv4();
const priorityUrgentId = uuidv4();
const priorityHighId = uuidv4();
const integrationId = uuidv4();
const assetId = uuidv4();
const ruleId = uuidv4();
const windowId = uuidv4();

function event(overrides: Partial<NormalizedRmmAlertEvent> = {}): NormalizedRmmAlertEvent {
  return {
    tenantId,
    integrationId,
    provider: 'ninjaone',
    kind: 'triggered',
    externalAlertId: `ext-${uuidv4().slice(0, 8)}`,
    externalDeviceId: 'dev-1',
    conditionIdentity: 'DISK_SPACE',
    activityType: 'CONDITION',
    alertClass: 'DISK_SPACE',
    sourceType: 'condition',
    severity: 'major',
    message: 'Disk C: is at 95% capacity',
    deviceName: 'SERVER-01',
    externalOrganizationId: '500',
    occurredAt: new Date().toISOString(),
    raw: { organizationId: 500, statusCode: 'DISK_SPACE' },
    ...overrides,
  };
}

async function hasColumn(table: string, column: string): Promise<boolean> {
  return db.schema.hasColumn(table, column);
}

async function ticketCount(): Promise<number> {
  const row = await db('tickets').where({ tenant: tenantId }).count('ticket_id as n').first();
  return Number(row?.n ?? 0);
}

async function commentCount(ticketId: string): Promise<number> {
  const row = await db('comments')
    .where({ tenant: tenantId, ticket_id: ticketId })
    .count('comment_id as n')
    .first();
  return Number(row?.n ?? 0);
}

beforeAll(async () => {
  process.env.DB_PORT = process.env.DB_PORT || '5432';
  process.env.APP_ENV = process.env.APP_ENV || 'test';
  db = await createTestDbConnection();

  await db('tenants').insert({
    tenant: tenantId,
    ...((await hasColumn('tenants', 'company_name'))
      ? { company_name: 'RMM Alert Test Tenant' }
      : { client_name: 'RMM Alert Test Tenant' }),
    email: `rmm-alerts-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `rmm-alerts-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `rmm-alerts-user-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('clients').insert([
    {
      tenant: tenantId,
      client_id: clientId,
      client_name: 'Acme Corp',
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
    {
      tenant: tenantId,
      client_id: orgOnlyClientId,
      client_name: 'Org-Mapped Only Co',
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
  ]);

  await db('boards').insert([
    { tenant: tenantId, board_id: boardId, board_name: 'Alerts', is_default: false },
    { tenant: tenantId, board_id: defaultBoardId, board_name: 'General', is_default: true },
  ]);

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
      { id: priorityUrgentId, name: 'Urgent', order: 1 },
      { id: priorityHighId, name: 'High', order: 2 },
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
    provider: 'ninjaone',
    instance_url: 'https://app.ninjarmm.com',
    is_active: true,
    connected_at: db.fn.now(),
    settings: JSON.stringify({}),
  });

  await db('rmm_organization_mappings').insert({
    tenant: tenantId,
    mapping_id: uuidv4(),
    integration_id: integrationId,
    external_organization_id: '500',
    external_organization_name: 'Acme Corp',
    client_id: orgOnlyClientId,
    auto_sync_assets: false,
    auto_create_tickets: false,
  });

  await db('assets').insert({
    tenant: tenantId,
    asset_id: assetId,
    asset_type: 'server',
    name: 'SERVER-01',
    asset_tag: 'RA-1',
    serial_number: 'SN-RA-1',
    status: 'active',
    client_id: clientId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('tenant_external_entity_mappings').insert({
    tenant: tenantId,
    id: uuidv4(),
    integration_type: 'ninjaone',
    alga_entity_type: 'asset',
    alga_entity_id: assetId,
    external_entity_id: 'dev-1',
    external_realm_id: '500',
    sync_status: 'synced',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  // Severity-filtered rule: 'none' severity alerts fall through to record-only.
  await db('rmm_alert_rules').insert({
    tenant: tenantId,
    rule_id: ruleId,
    integration_id: integrationId,
    name: 'Disk + general alerts',
    is_active: true,
    priority_order: 0,
    conditions: JSON.stringify({ severities: ['critical', 'major', 'moderate', 'minor'] }),
    actions: JSON.stringify({
      createTicket: true,
      boardId,
      priorityOverride: priorityUrgentId,
      assignToUserId: userId,
      ticketTemplate: { titleTemplate: '[Alert] {{device}}: {{message}}' },
      autoResolveTicket: true,
      resetAlertOnTicketClose: true,
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
    'tenant_external_entity_mappings',
    'rmm_organization_mappings',
    'rmm_integrations',
    'assets',
    'priorities',
    'statuses',
    'boards',
    'clients',
    'users',
    'tenants',
  ]) {
    await db(table)
      .where({ tenant: tenantId })
      .del()
      .catch(() => undefined);
  }
  await db.destroy().catch(() => undefined);
}, HOOK_TIMEOUT);

// Scenarios build on each other (create → dedup → reset → close), so opt out
// of config-level shuffling.
describe('processRmmAlertEvent (DB integration)', { shuffle: false }, () => {
  const firstExternalId = 'ext-first';
  let firstAlertId: string;
  let firstTicketId: string;

  it('creates a routed ticket for a triggered alert (rules, asset, templates, provenance)', async () => {
    const result = await processRmmAlertEvent({ knex: db }, event({ externalAlertId: firstExternalId }));

    expect(result.outcome).toBe('ticket_created');
    expect(result.matchedRuleId).toBe(ruleId);
    firstAlertId = result.alertId!;
    firstTicketId = result.ticketId!;

    const alert = await db('rmm_alerts').where({ tenant: tenantId, alert_id: firstAlertId }).first();
    expect(alert.status).toBe('active');
    expect(alert.dedup_key).toBe('dev-1|DISK_SPACE');
    expect(alert.matched_rule_id).toBe(ruleId);
    expect(alert.asset_id).toBe(assetId);
    expect(alert.auto_ticket_created).toBe(true);
    expect(alert.metadata).toMatchObject({ statusCode: 'DISK_SPACE' });

    const ticket = await db('tickets').where({ tenant: tenantId, ticket_id: firstTicketId }).first();
    expect(ticket.board_id).toBe(boardId);
    expect(ticket.priority_id).toBe(priorityUrgentId);
    expect(ticket.assigned_to).toBe(userId);
    expect(ticket.client_id).toBe(clientId); // from the asset, not the org mapping
    expect(ticket.status_id).toBe(statusOpenId);
    expect(ticket.source).toBe('ninjaone');
    expect(ticket.title).toBe('[Alert] SERVER-01: Disk C: is at 95% capacity');

    const association = await db('asset_associations')
      .where({ tenant: tenantId, entity_id: firstTicketId, entity_type: 'ticket' })
      .first();
    expect(association?.asset_id).toBe(assetId);

    expect(await commentCount(firstTicketId)).toBe(1); // initial internal note
  });

  it('treats a replayed delivery as a no-op', async () => {
    const before = await ticketCount();
    const result = await processRmmAlertEvent({ knex: db }, event({ externalAlertId: firstExternalId }));
    expect(result.outcome).toBe('skipped');
    expect(await ticketCount()).toBe(before);
  });

  it('appends repeat firings of the same condition to the open ticket', async () => {
    const before = await ticketCount();
    const result = await processRmmAlertEvent({ knex: db }, event({ externalAlertId: 'ext-second' }));

    expect(result.outcome).toBe('occurrence_appended');
    expect(result.ticketId).toBe(firstTicketId);
    expect(await ticketCount()).toBe(before);
    expect(await commentCount(firstTicketId)).toBe(2); // + re-trigger note

    const original = await db('rmm_alerts').where({ tenant: tenantId, alert_id: firstAlertId }).first();
    expect(Number(original.occurrence_count)).toBe(2);
  });

  it('creates a separate ticket for the same condition on a different device', async () => {
    const before = await ticketCount();
    const result = await processRmmAlertEvent(
      { knex: db },
      event({ externalAlertId: 'ext-dev2', externalDeviceId: 'dev-2', deviceName: 'SERVER-02' })
    );
    expect(result.outcome).toBe('ticket_created');
    expect(result.ticketId).not.toBe(firstTicketId);
    expect(await ticketCount()).toBe(before + 1);

    // Unmapped device: the client falls back to the organization mapping.
    const ticket = await db('tickets').where({ tenant: tenantId, ticket_id: result.ticketId! }).first();
    expect(ticket.client_id).toBe(orgOnlyClientId);
  });

  it('records without a ticket when no rule matches', async () => {
    const before = await ticketCount();
    const result = await processRmmAlertEvent(
      { knex: db },
      event({ externalAlertId: 'ext-noise', severity: 'none' })
    );
    expect(result.outcome).toBe('recorded_only');
    expect(await ticketCount()).toBe(before);
  });

  it('reset resolves the alert, comments, and auto-closes the untouched ticket', async () => {
    const result = await processRmmAlertEvent(
      { knex: db },
      event({ externalAlertId: firstExternalId, kind: 'reset' })
    );
    expect(result.outcome).toBe('resolved');

    const alert = await db('rmm_alerts').where({ tenant: tenantId, alert_id: firstAlertId }).first();
    expect(alert.status).toBe('auto_resolved');
    expect(alert.resolved_at).not.toBeNull();

    const ticket = await db('tickets').where({ tenant: tenantId, ticket_id: firstTicketId }).first();
    expect(ticket.status_id).toBe(statusClosedId);
    // resolution note + auto-close note on top of the existing two
    expect(await commentCount(firstTicketId)).toBe(4);
  });

  it('after the ticket closed, a new firing of the same condition opens a new ticket', async () => {
    const before = await ticketCount();
    const result = await processRmmAlertEvent({ knex: db }, event({ externalAlertId: 'ext-third' }));
    expect(result.outcome).toBe('ticket_created');
    expect(result.ticketId).not.toBe(firstTicketId);
    expect(await ticketCount()).toBe(before + 1);
  });

  it('reset leaves a human-touched ticket open (comment only)', async () => {
    const third = await db('rmm_alerts')
      .where({ tenant: tenantId, external_alert_id: 'ext-third' })
      .first();

    // A tech comments on the ticket.
    const threadId = uuidv4();
    const commentId = uuidv4();
    await db('comment_threads').insert({
      tenant: tenantId,
      thread_id: threadId,
      ticket_id: third.ticket_id,
      root_comment_id: commentId,
      is_internal: true,
      reply_count: 0,
      last_activity_at: db.fn.now(),
      created_at: db.fn.now(),
      created_by: userId,
    });
    await db('comments').insert({
      tenant: tenantId,
      comment_id: commentId,
      thread_id: threadId,
      ticket_id: third.ticket_id,
      user_id: userId,
      note: 'Investigating on the host.',
      is_internal: true,
      is_resolution: false,
      is_system_generated: false,
      created_at: db.fn.now(),
    });

    const result = await processRmmAlertEvent(
      { knex: db },
      event({ externalAlertId: 'ext-third', kind: 'reset' })
    );
    expect(result.outcome).toBe('resolved');

    const ticket = await db('tickets').where({ tenant: tenantId, ticket_id: third.ticket_id }).first();
    expect(ticket.status_id).toBe(statusOpenId); // stayed open

    const alert = await db('rmm_alerts').where({ tenant: tenantId, alert_id: third.alert_id }).first();
    expect(alert.status).toBe('resolved'); // resolved, not auto_resolved
  });

  it('suppresses alerts inside a matching maintenance window and resolves them quietly', async () => {
    const now = new Date();
    await db('rmm_maintenance_windows').insert({
      tenant: tenantId,
      window_id: windowId,
      integration_id: integrationId,
      client_id: null,
      asset_id: null,
      name: 'Patch window',
      is_active: true,
      starts_at: new Date(now.getTime() - 60_000).toISOString(),
      ends_at: new Date(now.getTime() + 3_600_000).toISOString(),
      recurrence: null,
    });

    const before = await ticketCount();
    const result = await processRmmAlertEvent({ knex: db }, event({ externalAlertId: 'ext-window' }));
    expect(result.outcome).toBe('suppressed');
    expect(result.suppressedByWindowId).toBe(windowId);
    expect(await ticketCount()).toBe(before);

    const alert = await db('rmm_alerts').where({ tenant: tenantId, alert_id: result.alertId! }).first();
    expect(alert.status).toBe('suppressed');
    expect(alert.suppressed_by_window_id).toBe(windowId);

    // Reset during the window resolves quietly.
    const reset = await processRmmAlertEvent(
      { knex: db },
      event({ externalAlertId: 'ext-window', kind: 'reset' })
    );
    expect(reset.outcome).toBe('resolved');
    const resolved = await db('rmm_alerts').where({ tenant: tenantId, alert_id: result.alertId! }).first();
    expect(resolved.status).toBe('resolved');
    expect(resolved.ticket_id).toBeNull();

    await db('rmm_maintenance_windows').where({ tenant: tenantId, window_id: windowId }).del();
  });

  it('acknowledged events stamp acknowledged status', async () => {
    // Distinct condition: the touched-ticket scenario left dev-1|DISK_SPACE
    // with an open ticket, which would absorb this alert via dedup.
    const trigger = await processRmmAlertEvent(
      { knex: db },
      event({ externalAlertId: 'ext-ack', conditionIdentity: 'CPU_HIGH', alertClass: 'CPU_HIGH' })
    );
    expect(trigger.outcome).toBe('ticket_created');

    const result = await processRmmAlertEvent(
      { knex: db },
      event({ externalAlertId: 'ext-ack', kind: 'acknowledged' })
    );
    expect(result.outcome).toBe('acknowledged');

    const alert = await db('rmm_alerts')
      .where({ tenant: tenantId, external_alert_id: 'ext-ack' })
      .first();
    expect(alert.status).toBe('acknowledged');
    expect(alert.acknowledged_at).not.toBeNull();
  });
});
