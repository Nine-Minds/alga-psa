import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '@main-test-utils/dbConfig';
import {
  createTicketForAlert,
  createTicketForAlertId,
  processRmmAlertEvent,
  registerRmmAlertFetcher,
  runRmmAlertReconciliation,
  type NormalizedRmmAlertEvent,
} from '@alga-psa/shared/rmm/alerts';

const HOOK_TIMEOUT = 180_000;

let db: Knex;

// Fixture ids
const tenantId = uuidv4();
const userId = uuidv4();
const clientId = uuidv4();
const orgOnlyClientId = uuidv4();
const noContactClientId = uuidv4();
const assetPrimaryContactId = uuidv4();
const orgPrimaryContactId = uuidv4();
const mappingDefaultContactId = uuidv4();
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

function tenantTable(table: string) {
  return tenantDb(db, tenantId).table(table);
}

async function ticketCount(): Promise<number> {
  const row = await tenantTable('tickets').where({ tenant: tenantId }).count('ticket_id as n').first();
  return Number(row?.n ?? 0);
}

async function commentCount(ticketId: string): Promise<number> {
  const row = await tenantTable('comments')
    .where({ tenant: tenantId, ticket_id: ticketId })
    .count('comment_id as n')
    .first();
  return Number(row?.n ?? 0);
}

beforeAll(async () => {
  process.env.DB_PORT = process.env.DB_PORT || '5432';
  process.env.APP_ENV = process.env.APP_ENV || 'test';
  db = await createTestDbConnection();

  await tenantTable('tenants').insert({
    tenant: tenantId,
    ...((await hasColumn('tenants', 'company_name'))
      ? { company_name: 'RMM Alert Test Tenant' }
      : { client_name: 'RMM Alert Test Tenant' }),
    email: `rmm-alerts-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await tenantTable('users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `rmm-alerts-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `rmm-alerts-user-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await tenantTable('clients').insert([
    {
      tenant: tenantId,
      client_id: clientId,
      client_name: 'Acme Corp',
      properties: JSON.stringify({ primary_contact_id: assetPrimaryContactId }),
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
    {
      tenant: tenantId,
      client_id: orgOnlyClientId,
      client_name: 'Org-Mapped Only Co',
      properties: JSON.stringify({ primary_contact_id: orgPrimaryContactId }),
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
    {
      tenant: tenantId,
      client_id: noContactClientId,
      client_name: 'No Contact Co',
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
      contact_name_id: assetPrimaryContactId,
      full_name: 'Asset Primary Contact',
      email: 'asset-primary@example.com',
      [contactClientColumn]: clientId,
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
    {
      tenant: tenantId,
      contact_name_id: orgPrimaryContactId,
      full_name: 'Org Primary Contact',
      email: 'org-primary@example.com',
      [contactClientColumn]: orgOnlyClientId,
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
    {
      tenant: tenantId,
      contact_name_id: mappingDefaultContactId,
      full_name: 'Mapping Default Contact',
      email: 'mapping-default@example.com',
      [contactClientColumn]: orgOnlyClientId,
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
  ]);

  await tenantTable('boards').insert([
    { tenant: tenantId, board_id: boardId, board_name: 'Alerts', is_default: false },
    { tenant: tenantId, board_id: defaultBoardId, board_name: 'General', is_default: true },
  ]);

  const statusItemType = {
    ...((await hasColumn('statuses', 'item_type')) ? { item_type: 'ticket' } : {}),
    ...((await hasColumn('statuses', 'status_type')) ? { status_type: 'ticket' } : {}),
  };
  // Statuses are board-scoped (the pipeline resolves defaults per board); the
  // shared ids live on the rule-routed board, the default board gets its own.
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
    {
      tenant: tenantId,
      status_id: uuidv4(),
      name: 'Open',
      ...statusItemType,
      board_id: defaultBoardId,
      is_closed: false,
      is_default: true,
      order_number: 10,
      created_by: userId,
    },
    {
      tenant: tenantId,
      status_id: uuidv4(),
      name: 'Closed',
      ...statusItemType,
      board_id: defaultBoardId,
      is_closed: true,
      is_default: false,
      order_number: 20,
      created_by: userId,
    },
  ]);

  await tenantTable('priorities').insert(
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

  await tenantTable('rmm_integrations').insert({
    tenant: tenantId,
    integration_id: integrationId,
    provider: 'ninjaone',
    instance_url: 'https://app.ninjarmm.com',
    is_active: true,
    connected_at: db.fn.now(),
    settings: JSON.stringify({}),
  });

  await tenantTable('rmm_organization_mappings').insert({
    tenant: tenantId,
    mapping_id: uuidv4(),
    integration_id: integrationId,
    external_organization_id: '500',
    external_organization_name: 'Acme Corp',
    client_id: orgOnlyClientId,
    default_contact_id: mappingDefaultContactId,
    auto_sync_assets: false,
    auto_create_tickets: false,
  });

  await tenantTable('assets').insert({
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

  await tenantTable('tenant_external_entity_mappings').insert({
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
  await tenantTable('rmm_alert_rules').insert({
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

// Scenarios build on each other (create → dedup → reset → close), so opt out
// of config-level shuffling.
describe('processRmmAlertEvent (DB integration)', { shuffle: false }, () => {
  const firstExternalId = 'ext-first';
  let firstAlertId: string;
  let firstTicketId: string;

  it('creates direct alert tickets with mapping default, client default, or no contact', async () => {
    const mappingTicket = await db.transaction((trx) =>
      createTicketForAlert(trx, {
        event: event({ externalAlertId: 'direct-mapping-contact', externalDeviceId: undefined }),
        actions: {
          createTicket: true,
          boardId,
          priorityOverride: priorityUrgentId,
          assignToUserId: userId,
        },
        clientId: orgOnlyClientId,
        mappingDefaultContactId,
      }),
    );
    const mappingRow = await tenantTable('tickets')
      .where({ tenant: tenantId, ticket_id: mappingTicket.ticket_id })
      .first();
    expect(mappingRow.contact_name_id).toBe(mappingDefaultContactId);
    expect(mappingRow.ticket_number).toBe(mappingTicket.ticket_number);

    const fallbackTicket = await db.transaction((trx) =>
      createTicketForAlert(trx, {
        event: event({ externalAlertId: 'direct-primary-contact', externalDeviceId: undefined }),
        actions: { createTicket: true, boardId },
        clientId: orgOnlyClientId,
      }),
    );
    const fallbackRow = await tenantTable('tickets')
      .where({ tenant: tenantId, ticket_id: fallbackTicket.ticket_id })
      .first();
    expect(fallbackRow.contact_name_id).toBe(orgPrimaryContactId);

    const noContactTicket = await db.transaction((trx) =>
      createTicketForAlert(trx, {
        event: event({ externalAlertId: 'direct-no-contact', externalDeviceId: undefined }),
        actions: { createTicket: true, boardId },
        clientId: noContactClientId,
      }),
    );
    const noContactRow = await tenantTable('tickets')
      .where({ tenant: tenantId, ticket_id: noContactTicket.ticket_id })
      .first();
    expect(noContactRow.contact_name_id).toBeNull();
  });

  it('creates a routed ticket for a triggered alert (rules, asset, templates, provenance)', async () => {
    const result = await processRmmAlertEvent({ knex: db }, event({ externalAlertId: firstExternalId }));

    expect(result.outcome).toBe('ticket_created');
    expect(result.matchedRuleId).toBe(ruleId);
    firstAlertId = result.alertId!;
    firstTicketId = result.ticketId!;

    const alert = await tenantTable('rmm_alerts').where({ tenant: tenantId, alert_id: firstAlertId }).first();
    expect(alert.status).toBe('active');
    expect(alert.dedup_key).toBe('dev-1|DISK_SPACE');
    expect(alert.matched_rule_id).toBe(ruleId);
    expect(alert.asset_id).toBe(assetId);
    expect(alert.auto_ticket_created).toBe(true);
    expect(alert.metadata).toMatchObject({ statusCode: 'DISK_SPACE' });

    const ticket = await tenantTable('tickets').where({ tenant: tenantId, ticket_id: firstTicketId }).first();
    expect(ticket.board_id).toBe(boardId);
    expect(ticket.priority_id).toBe(priorityUrgentId);
    expect(ticket.assigned_to).toBe(userId);
    expect(ticket.client_id).toBe(clientId); // from the asset, not the org mapping
    expect(ticket.contact_name_id).toBe(assetPrimaryContactId); // asset client primary, not the org mapping default
    expect(ticket.status_id).toBe(statusOpenId);
    expect(ticket.source).toBe('ninjaone');
    expect(ticket.title).toBe('[Alert] SERVER-01: Disk C: is at 95% capacity');

    const association = await tenantTable('asset_associations')
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

    const original = await tenantTable('rmm_alerts').where({ tenant: tenantId, alert_id: firstAlertId }).first();
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
    const ticket = await tenantTable('tickets').where({ tenant: tenantId, ticket_id: result.ticketId! }).first();
    expect(ticket.client_id).toBe(orgOnlyClientId);
    expect(ticket.contact_name_id).toBe(mappingDefaultContactId);
  });

  it('creates a manual alert ticket using the organization mapping default contact', async () => {
    const manualAlertId = uuidv4();
    await tenantTable('rmm_alerts').insert({
      tenant: tenantId,
      alert_id: manualAlertId,
      integration_id: integrationId,
      external_alert_id: 'manual-contact-default',
      external_device_id: null,
      asset_id: null,
      severity: 'major',
      status: 'active',
      source_type: 'condition',
      alert_class: 'MANUAL_CONTACT',
      message: 'Manual ticket from alert',
      device_name: 'ORG-DEVICE',
      dedup_key: 'manual-contact-default',
      triggered_at: new Date().toISOString(),
      last_occurrence_at: new Date().toISOString(),
      metadata: JSON.stringify({ organizationId: 500 }),
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    const created = await createTicketForAlertId(db, {
      tenantId,
      alertId: manualAlertId,
      overrides: { boardId, priorityOverride: priorityHighId },
    });

    const ticket = await tenantTable('tickets').where({ tenant: tenantId, ticket_id: created.ticket_id }).first();
    expect(ticket.client_id).toBe(orgOnlyClientId);
    expect(ticket.contact_name_id).toBe(mappingDefaultContactId);

    const alert = await tenantTable('rmm_alerts').where({ tenant: tenantId, alert_id: manualAlertId }).first();
    expect(alert.ticket_id).toBe(created.ticket_id);
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

    const alert = await tenantTable('rmm_alerts').where({ tenant: tenantId, alert_id: firstAlertId }).first();
    expect(alert.status).toBe('auto_resolved');
    expect(alert.resolved_at).not.toBeNull();

    const ticket = await tenantTable('tickets').where({ tenant: tenantId, ticket_id: firstTicketId }).first();
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
    const third = await tenantTable('rmm_alerts')
      .where({ tenant: tenantId, external_alert_id: 'ext-third' })
      .first();

    // A tech comments on the ticket.
    const threadId = uuidv4();
    const commentId = uuidv4();
    await tenantTable('comment_threads').insert({
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
    await tenantTable('comments').insert({
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

    const ticket = await tenantTable('tickets').where({ tenant: tenantId, ticket_id: third.ticket_id }).first();
    expect(ticket.status_id).toBe(statusOpenId); // stayed open

    const alert = await tenantTable('rmm_alerts').where({ tenant: tenantId, alert_id: third.alert_id }).first();
    expect(alert.status).toBe('resolved'); // resolved, not auto_resolved
  });

  it('suppresses alerts inside a matching maintenance window and resolves them quietly', async () => {
    const now = new Date();
    await tenantTable('rmm_maintenance_windows').insert({
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

    const alert = await tenantTable('rmm_alerts').where({ tenant: tenantId, alert_id: result.alertId! }).first();
    expect(alert.status).toBe('suppressed');
    expect(alert.suppressed_by_window_id).toBe(windowId);

    // Reset during the window resolves quietly.
    const reset = await processRmmAlertEvent(
      { knex: db },
      event({ externalAlertId: 'ext-window', kind: 'reset' })
    );
    expect(reset.outcome).toBe('resolved');
    const resolved = await tenantTable('rmm_alerts').where({ tenant: tenantId, alert_id: result.alertId! }).first();
    expect(resolved.status).toBe('resolved');
    expect(resolved.ticket_id).toBeNull();

    await tenantTable('rmm_maintenance_windows').where({ tenant: tenantId, window_id: windowId }).del();
  });

  it('a ticket with a time entry counts as touched and survives the reset', async () => {
    const trigger = await processRmmAlertEvent(
      { knex: db },
      event({ externalAlertId: 'ext-timed', conditionIdentity: 'BACKUP_FAIL', alertClass: 'BACKUP_FAIL' })
    );
    expect(trigger.outcome).toBe('ticket_created');

    await tenantTable('time_entries').insert({
      tenant: tenantId,
      entry_id: uuidv4(),
      user_id: userId,
      start_time: new Date(Date.now() - 600_000).toISOString(),
      end_time: new Date().toISOString(),
      work_item_id: trigger.ticketId!,
      work_item_type: 'ticket',
      billable_duration: 10,
      work_date: new Date().toISOString().slice(0, 10),
      work_timezone: 'UTC',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const reset = await processRmmAlertEvent(
      { knex: db },
      event({ externalAlertId: 'ext-timed', kind: 'reset' })
    );
    expect(reset.outcome).toBe('resolved');
    const ticket = await tenantTable('tickets').where({ tenant: tenantId, ticket_id: trigger.ticketId! }).first();
    expect(ticket.status_id).toBe(statusOpenId);
  });

  it('a manual status change counts as touched and survives the reset', async () => {
    const inProgressId = uuidv4();
    await tenantTable('statuses').insert({
      tenant: tenantId,
      status_id: inProgressId,
      name: 'In Progress',
      ...((await hasColumn('statuses', 'item_type')) ? { item_type: 'ticket' } : {}),
      ...((await hasColumn('statuses', 'status_type')) ? { status_type: 'ticket' } : {}),
      is_closed: false,
      is_default: false,
      order_number: 15,
      created_by: userId,
    });

    const trigger = await processRmmAlertEvent(
      { knex: db },
      event({ externalAlertId: 'ext-moved', conditionIdentity: 'AV_THREAT', alertClass: 'AV_THREAT' })
    );
    expect(trigger.outcome).toBe('ticket_created');

    await tenantTable('tickets')
      .where({ tenant: tenantId, ticket_id: trigger.ticketId! })
      .update({ status_id: inProgressId });

    const reset = await processRmmAlertEvent(
      { knex: db },
      event({ externalAlertId: 'ext-moved', kind: 'reset' })
    );
    expect(reset.outcome).toBe('resolved');
    const ticket = await tenantTable('tickets').where({ tenant: tenantId, ticket_id: trigger.ticketId! }).first();
    expect(ticket.status_id).toBe(inProgressId); // stayed where the human put it
  });

  it('publishes workflow events for non-suppressed outcomes via injected deps', async () => {
    const published: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
    const deps = {
      publishWorkflowEvent: async (args: { eventType: string; tenantId: string; payload: Record<string, unknown> }) => {
        published.push({ eventType: args.eventType, payload: args.payload });
      },
    };

    const trigger = await processRmmAlertEvent(
      { knex: db, deps },
      event({ externalAlertId: 'ext-events', conditionIdentity: 'SVC_DOWN', alertClass: 'SVC_DOWN' })
    );
    expect(trigger.outcome).toBe('ticket_created');
    await processRmmAlertEvent({ knex: db, deps }, event({ externalAlertId: 'ext-events', kind: 'reset' }));

    expect(published.map((p) => p.eventType)).toEqual(['RMM_ALERT_TRIGGERED', 'RMM_ALERT_RESOLVED']);
    expect(published[0].payload).toMatchObject({
      tenantId,
      integrationId,
      provider: 'ninjaone',
      alertId: trigger.alertId,
      ticketId: trigger.ticketId,
      severity: 'major',
      assetId,
    });
    expect(published[1].payload).toMatchObject({ alertId: trigger.alertId });
  });

  it('ignores inactive rules and falls back through priority order', async () => {
    // An inactive catch-all that would shadow everything if considered.
    const inactiveRuleId = uuidv4();
    await tenantTable('rmm_alert_rules').insert({
      tenant: tenantId,
      rule_id: inactiveRuleId,
      integration_id: integrationId,
      name: 'Disabled catch-all',
      is_active: false,
      priority_order: -10,
      conditions: JSON.stringify({}),
      actions: JSON.stringify({ createTicket: false }),
    });

    const result = await processRmmAlertEvent(
      { knex: db },
      event({ externalAlertId: 'ext-inactive', conditionIdentity: 'MEM_HIGH', alertClass: 'MEM_HIGH' })
    );
    expect(result.outcome).toBe('ticket_created');
    expect(result.matchedRuleId).toBe(ruleId);
    await tenantTable('rmm_alert_rules').where({ tenant: tenantId, rule_id: inactiveRuleId }).del();
  });

  it('maps severity to a tenant priority by name when the rule has no override', async () => {
    const fallbackRuleId = uuidv4();
    await tenantTable('rmm_alert_rules').insert({
      tenant: tenantId,
      rule_id: fallbackRuleId,
      integration_id: integrationId,
      name: 'Fallback priority rule',
      is_active: true,
      priority_order: -1,
      conditions: JSON.stringify({ alertClasses: ['SMART_FAIL'] }),
      actions: JSON.stringify({ createTicket: true, boardId }),
    });

    const result = await processRmmAlertEvent(
      { knex: db },
      event({
        externalAlertId: 'ext-fallback',
        conditionIdentity: 'SMART_FAIL',
        alertClass: 'SMART_FAIL',
        severity: 'major',
        message: undefined,
      })
    );
    expect(result.outcome).toBe('ticket_created');

    const ticket = await tenantTable('tickets').where({ tenant: tenantId, ticket_id: result.ticketId! }).first();
    expect(ticket.priority_id).toBe(priorityHighId); // major → 'High'
    // No template on this rule: the default title applies.
    expect(ticket.title).toContain('[NinjaOne Alert] SMART_FAIL on SERVER-01');
    await tenantTable('rmm_alert_rules').where({ tenant: tenantId, rule_id: fallbackRuleId }).del();
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

    const alert = await tenantTable('rmm_alerts')
      .where({ tenant: tenantId, external_alert_id: 'ext-ack' })
      .first();
    expect(alert.status).toBe('acknowledged');
    expect(alert.acknowledged_at).not.toBeNull();
  });
});

describe('runRmmAlertReconciliation (DB integration)', { shuffle: false }, () => {
  // The fetcher's "RMM truth" is this mutable list.
  let remoteActive: NormalizedRmmAlertEvent[] = [];

  beforeAll(() => {
    registerRmmAlertFetcher('ninjaone', {
      fetchActiveAlerts: async () => remoteActive,
    });
  });

  it('turns a missed RMM-active alert into a ticket through the rules path', async () => {
    remoteActive = [
      event({ externalAlertId: 'recon-1', conditionIdentity: 'RECON_DISK', alertClass: 'RECON_DISK' }),
    ];
    const result = await runRmmAlertReconciliation(
      { knex: db },
      { tenantId, integrationId, provider: 'ninjaone' }
    );
    expect(result.skipped).toBe(false);
    expect(result.ingested).toBe(1);

    const alert = await tenantTable('rmm_alerts').where({ tenant: tenantId, external_alert_id: 'recon-1' }).first();
    expect(alert.status).toBe('active');
    expect(alert.ticket_id).not.toBeNull();
    expect(alert.metadata).toMatchObject({ __alga_ingest_source: 'reconciliation' });
  });

  it('a repeat cycle is a no-op while the alert stays active in the RMM', async () => {
    const result = await runRmmAlertReconciliation(
      { knex: db },
      { tenantId, integrationId, provider: 'ninjaone' }
    );
    expect(result.ingested).toBe(0);
    expect(result.resetsSynthesized).toBe(0);
  });

  it('synthesizes resets only for poller-ingested alerts that left the RMM', async () => {
    // A webhook-created alert (no reconciliation marker) that the fetcher
    // doesn't know about must never be closed by the poller.
    const webhook = await processRmmAlertEvent(
      { knex: db },
      event({
        externalAlertId: 'recon-webhook-origin',
        conditionIdentity: 'RECON_WEBHOOK',
        alertClass: 'RECON_WEBHOOK',
      })
    );
    expect(webhook.outcome).toBe('ticket_created');

    remoteActive = [];
    const result = await runRmmAlertReconciliation(
      { knex: db },
      { tenantId, integrationId, provider: 'ninjaone' }
    );
    expect(result.resetsSynthesized).toBe(1);

    const reconAlert = await tenantTable('rmm_alerts').where({ tenant: tenantId, external_alert_id: 'recon-1' }).first();
    expect(['resolved', 'auto_resolved']).toContain(reconAlert.status);
    const reconTicket = await tenantTable('tickets').where({ tenant: tenantId, ticket_id: reconAlert.ticket_id }).first();
    expect(reconTicket.status_id).toBe(statusClosedId); // untouched → auto-closed

    const webhookAlert = await tenantTable('rmm_alerts')
      .where({ tenant: tenantId, external_alert_id: 'recon-webhook-origin' })
      .first();
    expect(webhookAlert.status).toBe('active'); // conservatively untouched
  });

  it('reprocesses a still-active suppressed alert once its window ends', async () => {
    const reconWindowId = uuidv4();
    await tenantTable('rmm_maintenance_windows').insert({
      tenant: tenantId,
      window_id: reconWindowId,
      integration_id: integrationId,
      name: 'Recon window',
      is_active: true,
      starts_at: new Date(Date.now() - 60_000).toISOString(),
      ends_at: new Date(Date.now() + 3_600_000).toISOString(),
      recurrence: null,
    });

    remoteActive = [
      event({ externalAlertId: 'recon-window', conditionIdentity: 'RECON_SVC', alertClass: 'RECON_SVC' }),
    ];
    let result = await runRmmAlertReconciliation({ knex: db }, { tenantId, integrationId, provider: 'ninjaone' });
    expect(result.ingested).toBe(1);
    let alert = await tenantTable('rmm_alerts').where({ tenant: tenantId, external_alert_id: 'recon-window' }).first();
    expect(alert.status).toBe('suppressed');
    expect(alert.ticket_id).toBeNull();

    // Window ends; the condition is still firing in the RMM.
    await tenantTable('rmm_maintenance_windows')
      .where({ tenant: tenantId, window_id: reconWindowId })
      .update({ is_active: false });

    result = await runRmmAlertReconciliation({ knex: db }, { tenantId, integrationId, provider: 'ninjaone' });
    expect(result.ingested).toBe(1);
    alert = await tenantTable('rmm_alerts').where({ tenant: tenantId, external_alert_id: 'recon-window' }).first();
    expect(alert.status).toBe('active');
    expect(alert.ticket_id).not.toBeNull();

    await tenantTable('rmm_maintenance_windows').where({ tenant: tenantId, window_id: reconWindowId }).del();
  });

  it('an alert known from a webhook is not duplicated by the poller (same id)', async () => {
    const webhook = await processRmmAlertEvent(
      { knex: db },
      event({ externalAlertId: 'both-paths', conditionIdentity: 'RECON_CPU', alertClass: 'RECON_CPU' })
    );
    expect(webhook.outcome).toBe('ticket_created');

    const before = await tenantTable('tickets').where({ tenant: tenantId }).count('ticket_id as n').first();
    remoteActive = [
      event({ externalAlertId: 'both-paths', conditionIdentity: 'RECON_CPU', alertClass: 'RECON_CPU' }),
    ];
    const result = await runRmmAlertReconciliation({ knex: db }, { tenantId, integrationId, provider: 'ninjaone' });
    expect(result.ingested).toBe(0); // redelivery no-op

    const after = await tenantTable('tickets').where({ tenant: tenantId }).count('ticket_id as n').first();
    expect(Number(after?.n)).toBe(Number(before?.n));
    const rows = await tenantTable('rmm_alerts').where({ tenant: tenantId, external_alert_id: 'both-paths' });
    expect(rows).toHaveLength(1);
  });
});
