import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '@main-test-utils/dbConfig';
import { createUniFiAlertFetcher } from '../../lib/integrations/unifi/alerts/reconciliationFetcher';
import {
  createTicketForAlert,
  createTicketForAlertId,
  evaluateAlertRules,
  processRmmAlertEvent,
  reconcileConditionObservations,
  acknowledgeConditionTransition,
  registerRmmAlertFetcher,
  runRmmAlertReconciliation,
  type NormalizedRmmAlertEvent,
  type RmmAlertRuleRow,
  type RmmAlertRuleActions,
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
        } as RmmAlertRuleActions,
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
        actions: { createTicket: true, boardId } as RmmAlertRuleActions,
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
        actions: { createTicket: true, boardId } as RmmAlertRuleActions,
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

  it('records the Level Sentinel service only and lets unrelated alerts reach the ticket catch-all', async () => {
    const targetedRuleId = uuidv4();
    await tenantTable('rmm_integrations').where({ tenant: tenantId, integration_id: integrationId }).update({ provider: 'levelio' });
    try {
      await tenantTable('rmm_alert_rules').insert({
      tenant: tenantId, rule_id: targetedRuleId, integration_id: integrationId,
      name: 'Record Sentinel Service Crash', is_active: true, priority_order: -1,
      conditions: JSON.stringify({ join: 'and', clauses: [
        { path: 'alertClass', operator: 'equals', value: 'Critical Service Crashed' },
        { path: 'text', operator: 'contains_ci', value: 'Sentinel Agent service terminated' },
        { path: 'deviceName', operator: 'equals', value: 'GLICK-PC7' },
      ] }),
      actions: JSON.stringify({ createTicket: false }),
      });
      const before = await ticketCount();
      const sentinelEvent = event({
        provider: 'levelio', externalAlertId: 'level-sentinel-service-crash', externalDeviceId: 'level-device-7',
        alertClass: 'Critical Service Crashed', deviceName: 'GLICK-PC7',
        message: 'Critical Service Crashed: Event ID 7031 occured 5 times within 1 hour',
        details: 'The Sentinel Agent service terminated unexpectedly. It has done this 532 time(s)',
      });
      const orderedRules = await tenantTable('rmm_alert_rules').where({ tenant: tenantId, integration_id: integrationId, is_active: true }).orderBy('priority_order', 'asc') as unknown as RmmAlertRuleRow[];
      const directEvaluation = evaluateAlertRules(orderedRules, sentinelEvent);
      expect(directEvaluation.rule?.rule_id, JSON.stringify({
        warnings: directEvaluation.warnings,
        orderedRules: orderedRules.map(({ rule_id, priority_order, conditions }) => ({ rule_id, priority_order, conditions })),
      })).toBe(targetedRuleId);
      const sentinel = await processRmmAlertEvent({ knex: db }, sentinelEvent);
      expect(sentinel.outcome).toBe('recorded_only');
      expect(sentinel.matchedRuleId).toBe(targetedRuleId);
      expect(await ticketCount()).toBe(before);
      const recordedSentinel = await tenantTable('rmm_alerts').where({ tenant: tenantId, alert_id: sentinel.alertId }).first();
      const recordedMetadata = typeof recordedSentinel.metadata === 'string' ? JSON.parse(recordedSentinel.metadata) : recordedSentinel.metadata;
      expect(recordedMetadata._algaNormalized.details).toBe('The Sentinel Agent service terminated unexpectedly. It has done this 532 time(s)');

      // Reconciliation exercises a real Tactical provider mapper from a raw
      // provider response; it must not inject a pre-normalized details field.
      const { mapTacticalAlertToEvent } = await import('../../../../../packages/integrations/src/lib/rmm/tacticalrmm/alertFetcher');
      await tenantTable('rmm_integrations').where({ tenant: tenantId, integration_id: integrationId }).update({ provider: 'tacticalrmm' });
      registerRmmAlertFetcher('tacticalrmm', { fetchActiveAlerts: async () => [mapTacticalAlertToEvent({
        id: 'tactical-reconciliation-sentinel', agent_id: 'level-device-7', alert_type: 'Critical Service Crashed',
        hostname: 'GLICK-PC7', message: 'Critical Service Crashed: Event ID 7031 occured 5 times within 1 hour',
        description: 'The Sentinel Agent service terminated unexpectedly. It has done this 532 time(s)',
      }, tenantId, integrationId)!] });
      const reconciliation = await runRmmAlertReconciliation({ knex: db }, { tenantId, integrationId, provider: 'tacticalrmm' });
      expect(reconciliation.ingested).toBe(1);
      const reconciledSentinel = await tenantTable('rmm_alerts').where({ tenant: tenantId, external_alert_id: 'tactical-reconciliation-sentinel' }).first();
      expect(reconciledSentinel.matched_rule_id).toBe(targetedRuleId);
      const reconciledMetadata = typeof reconciledSentinel.metadata === 'string' ? JSON.parse(reconciledSentinel.metadata) : reconciledSentinel.metadata;
      expect(reconciledMetadata._algaNormalized.details).toBe('The Sentinel Agent service terminated unexpectedly. It has done this 532 time(s)');
      await tenantTable('rmm_integrations').where({ tenant: tenantId, integration_id: integrationId }).update({ provider: 'levelio' });

      const otherService = await processRmmAlertEvent({ knex: db }, event({
        provider: 'levelio', externalAlertId: 'level-other-service-crash', externalDeviceId: 'level-device-7',
        alertClass: 'Critical Service Crashed', deviceName: 'GLICK-PC7',
        message: 'Critical Service Crashed: Event ID 7031 occured 5 times within 1 hour',
        details: 'Other Service terminated unexpectedly.',
      }));
      expect(otherService.outcome).toBe('ticket_created');

      const otherDevice = await processRmmAlertEvent({ knex: db }, event({
        provider: 'levelio', externalAlertId: 'level-sentinel-other-device', externalDeviceId: 'level-device-8',
        alertClass: 'Critical Service Crashed', deviceName: 'OTHER-PC',
        message: 'Critical Service Crashed: Event ID 7031 occured 5 times within 1 hour',
        details: 'The Sentinel Agent service terminated unexpectedly.',
      }));
      expect(otherDevice.outcome).toBe('ticket_created');
    } finally {
      await tenantTable('rmm_alert_rules').where({ tenant: tenantId, rule_id: targetedRuleId }).del();
      await tenantTable('rmm_integrations').where({ tenant: tenantId, integration_id: integrationId }).update({ provider: 'ninjaone' });
    }
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
      publishRmmAlertEvent: async (args: { eventType: string; tenantId: string; payload: Record<string, unknown> }) => {
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

  it('resets an alert whose linked ticket was deleted without failing the cycle', async () => {
    remoteActive = [
      event({ externalAlertId: 'recon-orphan', conditionIdentity: 'RECON_ORPHAN', alertClass: 'RECON_ORPHAN' }),
    ];
    await runRmmAlertReconciliation({ knex: db }, { tenantId, integrationId, provider: 'ninjaone' });
    await tenantTable('rmm_alerts')
      .where({ tenant: tenantId, external_alert_id: 'recon-orphan' })
      .update({ ticket_id: uuidv4() });

    remoteActive = [];
    const result = await runRmmAlertReconciliation(
      { knex: db },
      { tenantId, integrationId, provider: 'ninjaone' }
    );
    expect(result.resetsSynthesized).toBe(1);

    const orphan = await tenantTable('rmm_alerts')
      .where({ tenant: tenantId, external_alert_id: 'recon-orphan' })
      .first();
    expect(orphan.status).toBe('resolved');
    expect(orphan.ticket_id).toBeNull();
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

describe('observation lifecycle through the RMM ticket pipeline (DB integration)', { shuffle: false }, () => {
  it('creates one outage ticket, recovers it, and creates a distinct second outage without asset sync', async () => {
    const lifecycleIntegrationId = uuidv4();
    const lifecycleRuleId = uuidv4();
    const lifecycleScope = `unifi-site-${uuidv4().slice(0, 8)}`;
    await tenantTable('rmm_integrations').insert({
      tenant: tenantId, integration_id: lifecycleIntegrationId, provider: 'unifi', is_active: true, settings: JSON.stringify({}),
    });
    await tenantTable('rmm_organization_mappings').insert({
      tenant: tenantId, mapping_id: uuidv4(), integration_id: lifecycleIntegrationId,
      external_organization_id: lifecycleScope, external_organization_name: 'UniFi Lifecycle Site',
      client_id: orgOnlyClientId, auto_sync_assets: false, auto_create_tickets: false,
    });
    await tenantTable('rmm_alert_rules').insert({
      tenant: tenantId, rule_id: lifecycleRuleId, integration_id: lifecycleIntegrationId,
      name: 'UniFi offline lifecycle', is_active: true, priority_order: 0,
      conditions: JSON.stringify({ activityTypes: ['DEVICE_OFFLINE'] }),
      actions: JSON.stringify({ createTicket: true, boardId, priorityOverride: priorityHighId, autoResolveTicket: true }),
    });

    const subject = `unifi-device-${uuidv4().slice(0, 8)}`;
    const observation = (evidence: 'failing' | 'healthy', observedAt: string, subjectKey = subject) => ({
      scopeKey: lifecycleScope, subjectKey, conditionKey: 'device_offline', evidence, observedAt,
      event: {
        tenantId, integrationId: lifecycleIntegrationId, provider: 'unifi' as const,
        externalDeviceId: subjectKey, conditionIdentity: 'device_offline', activityType: 'DEVICE_OFFLINE',
        alertClass: 'switch', sourceType: 'unifi_device_state', severity: evidence === 'healthy' ? 'none' as const : 'major' as const,
        message: 'Core switch offline', deviceName: 'Core switch', externalOrganizationId: lifecycleScope,
        raw: { scopeKey: lifecycleScope, subjectKey: subject, conditionKey: 'device_offline' },
      },
    });
    const context = { knex: db };
    const graceMs = 60_000;
    const maxEvidenceGapMs = 300_000;
    const run = (observations: ReturnType<typeof observation>[], now: string) => reconcileConditionObservations({
      knex: db, tenantId, integrationId: lifecycleIntegrationId, observations,
      successfulScopes: [lifecycleScope], graceMs, maxEvidenceGapMs, now: new Date(now),
    });
    const deliver = async (transition: NormalizedRmmAlertEvent) => {
      const processed = await processRmmAlertEvent(context, transition, { reprocessSuppressed: true });
      if (transition.raw.transitionId && processed.outcome !== 'deferred') {
        await acknowledgeConditionTransition(context, {
          tenantId, integrationId: lifecycleIntegrationId, transitionId: String(transition.raw.transitionId),
        });
      }
      return processed;
    };
    const reconcileThroughPipeline = async (events: NormalizedRmmAlertEvent[]) => {
      registerRmmAlertFetcher('unifi', {
        fetchActiveAlerts: async () => events,
        fetchActiveAlertSnapshot: async () => ({ events, heldExternalAlertIds: [] }),
      });
      return runRmmAlertReconciliation(context, {
        tenantId, integrationId: lifecycleIntegrationId, provider: 'unifi',
      });
    };

    await expect(run([observation('failing', '2026-11-03T12:00:00.000Z')], '2026-11-03T12:00:00.000Z'))
      .resolves.toMatchObject({ events: [] });
    const firstTrigger = await run([observation('failing', '2026-11-03T12:01:01.000Z')], '2026-11-03T12:01:01.000Z');
    expect(firstTrigger.events).toHaveLength(1);
    const concurrentDeliveries = await Promise.all([deliver(firstTrigger.events[0]), deliver(firstTrigger.events[0])]);
    expect(concurrentDeliveries.map((result) => result.outcome).sort()).toEqual(['skipped', 'ticket_created']);
    const firstAlert = await tenantTable('rmm_alerts').where({ tenant: tenantId, integration_id: lifecycleIntegrationId, external_alert_id: firstTrigger.events[0].externalAlertId }).first();
    const firstTicketId = firstAlert.ticket_id;
    expect(firstTicketId).toBeTruthy();

    const repeated = await run([observation('failing', '2026-11-03T12:01:30.000Z')], '2026-11-03T12:01:30.000Z');
    expect(repeated.events).toHaveLength(0);
    expect(repeated.heldExternalAlertIds).toContain(firstTrigger.events[0].externalAlertId);
    expect(await tenantTable('rmm_condition_transitions').where({ tenant: tenantId,
      integration_id: lifecycleIntegrationId,
      external_alert_id: firstTrigger.events[0].externalAlertId }).select('transition_id')).toHaveLength(1);
    expect((await tenantTable('rmm_alerts').where({ tenant: tenantId, integration_id: lifecycleIntegrationId, external_alert_id: firstTrigger.events[0].externalAlertId }).first()).ticket_id).toBe(firstTicketId);

    const recovery = await run([observation('healthy', '2026-11-03T12:02:00.000Z')], '2026-11-03T12:02:00.000Z');
    expect(recovery.events).toHaveLength(1);
    expect((await deliver(recovery.events[0])).outcome).toBe('resolved');
    const resolved = await tenantTable('rmm_alerts').where({ tenant: tenantId, integration_id: lifecycleIntegrationId, external_alert_id: firstTrigger.events[0].externalAlertId }).first();
    expect(resolved.status).toBe('auto_resolved');
    expect(resolved.ticket_id).toBe(firstTicketId);

    // A delayed/replayed trigger must be rejected inside the pipeline
    // transaction after explicit recovery, even if a worker held a stale copy.
    expect((await deliver(firstTrigger.events[0])).outcome).toBe('skipped');
    const afterReplay = await tenantTable('rmm_alerts').where({ tenant: tenantId, integration_id: lifecycleIntegrationId, external_alert_id: firstTrigger.events[0].externalAlertId }).first();
    expect(afterReplay.status).toBe('auto_resolved');
    expect(afterReplay.ticket_id).toBe(firstTicketId);

    await run([observation('failing', '2026-11-03T12:03:00.000Z')], '2026-11-03T12:03:00.000Z');
    const secondTrigger = await run([observation('failing', '2026-11-03T12:04:01.000Z')], '2026-11-03T12:04:01.000Z');
    expect(secondTrigger.events).toHaveLength(1);
    expect(secondTrigger.events[0].externalAlertId).not.toBe(firstTrigger.events[0].externalAlertId);
    expect((await deliver(secondTrigger.events[0])).outcome).toBe('ticket_created');
    const secondAlert = await tenantTable('rmm_alerts').where({ tenant: tenantId, integration_id: lifecycleIntegrationId, external_alert_id: secondTrigger.events[0].externalAlertId }).first();
    expect(secondAlert.ticket_id).not.toBe(firstTicketId);
    expect((await tenantTable('rmm_alerts').where({ tenant: tenantId, integration_id: lifecycleIntegrationId })).map((row: any) => row.external_alert_id))
      .toEqual(expect.arrayContaining([firstTrigger.events[0].externalAlertId, secondTrigger.events[0].externalAlertId]));

    // Lifecycle-owned alerts must never be reset because an older snapshot
    // omits them. Recovery is delivered only from explicit healthy evidence.
    let signalOlderFetchStarted!: () => void;
    let releaseOlderFetch!: () => void;
    const olderFetchStarted = new Promise<void>((resolve) => { signalOlderFetchStarted = resolve; });
    const olderFetchGate = new Promise<void>((resolve) => { releaseOlderFetch = resolve; });
    registerRmmAlertFetcher('unifi', {
      fetchActiveAlerts: async () => [],
      fetchActiveAlertSnapshot: async () => {
        signalOlderFetchStarted();
        await olderFetchGate;
        return { events: [], heldExternalAlertIds: [] };
      },
    });
    const delayedOlderReconciliation = runRmmAlertReconciliation(context, {
      tenantId, integrationId: lifecycleIntegrationId, provider: 'unifi',
    });
    await olderFetchStarted;
    const newerEvidence = await run([observation('failing', '2026-11-03T12:04:30.000Z')], '2026-11-03T12:04:30.000Z');
    expect(newerEvidence.events).toHaveLength(0);
    expect(newerEvidence.heldExternalAlertIds).toContain(secondTrigger.events[0].externalAlertId);
    releaseOlderFetch();
    await delayedOlderReconciliation;
    const afterStaleSnapshot = await tenantTable('rmm_alerts').where({
      tenant: tenantId, integration_id: lifecycleIntegrationId,
      external_alert_id: secondTrigger.events[0].externalAlertId,
    }).first();
    expect(afterStaleSnapshot.status).toBe('active');

    // A durable recovery is the head of this condition's outbox. A later
    // outage cannot enter ticket dedupe until that recovery is acknowledged.
    await run([observation('healthy', '2026-11-03T12:05:00.000Z')], '2026-11-03T12:05:00.000Z');
    const queuedSecondOutage = await run([observation('failing', '2026-11-03T12:06:00.000Z')], '2026-11-03T12:06:00.000Z');
    expect(queuedSecondOutage.events.map((item) => item.kind)).toEqual(['reset']);
    await Promise.all([
      reconcileThroughPipeline(queuedSecondOutage.events),
      reconcileThroughPipeline(queuedSecondOutage.events),
    ]);
    const deliveredNextOutage = await run([observation('failing', '2026-11-03T12:07:01.000Z')], '2026-11-03T12:07:01.000Z');
    expect(deliveredNextOutage.events.map((item) => item.kind)).toEqual(['triggered']);
    await reconcileThroughPipeline(deliveredNextOutage.events);
    const thirdAlert = await tenantTable('rmm_alerts').where({
      tenant: tenantId, integration_id: lifecycleIntegrationId,
      external_alert_id: deliveredNextOutage.events[0].externalAlertId,
    }).first();
    expect(thirdAlert.ticket_id).not.toBe(secondAlert.ticket_id);
    expect((await tenantTable('rmm_alerts').where({ tenant: tenantId, integration_id: lifecycleIntegrationId,
      external_alert_id: secondTrigger.events[0].externalAlertId }).first()).status).toBe('auto_resolved');

    // Maintenance suppression can be reconsidered by fresh failure evidence
    // while retaining the original outage id and alert row.
    const maintenanceWindowId = uuidv4();
    const maintenanceSubject = `maintenance-${uuidv4()}`;
    const windowStart = new Date(Date.now() - 120_000).toISOString();
    const windowEnd = new Date(Date.now() + 60_000).toISOString();
    const maintenanceFirstFailureAt = new Date(Date.now() - 90_000).toISOString();
    const maintenanceTriggerAt = new Date(Date.now() - 20_000).toISOString();
    await tenantTable('rmm_maintenance_windows').insert({
      tenant: tenantId, window_id: maintenanceWindowId, integration_id: lifecycleIntegrationId,
      name: 'Lifecycle maintenance', is_active: true, starts_at: windowStart, ends_at: windowEnd,
      recurrence: null,
    });
    await run([observation('failing', maintenanceFirstFailureAt, maintenanceSubject)], maintenanceFirstFailureAt);
    const suppressed = await run([observation('failing', maintenanceTriggerAt, maintenanceSubject)], maintenanceTriggerAt);
    expect(suppressed.events).toHaveLength(1);
    await reconcileThroughPipeline(suppressed.events);
    const outageBeforeRecheck = await tenantTable('rmm_condition_states').where({ tenant: tenantId,
      integration_id: lifecycleIntegrationId, scope_key: lifecycleScope, subject_key: maintenanceSubject,
      condition_key: 'device_offline' }).first();
    const suppressedAlert = await tenantTable('rmm_alerts').where({ tenant: tenantId,
      integration_id: lifecycleIntegrationId, external_alert_id: suppressed.events[0].externalAlertId }).first();
    expect(suppressedAlert.status).toBe('suppressed');
    expect(suppressedAlert.ticket_id).toBeNull();
    await tenantTable('rmm_maintenance_windows').where({ tenant: tenantId, window_id: maintenanceWindowId })
      .update({ is_active: false });
    const maintenanceRecheckAt = new Date(Date.now() + 1_000).toISOString();
    const recheck = await run([observation('failing', maintenanceRecheckAt, maintenanceSubject)], maintenanceRecheckAt);
    expect(recheck.events).toHaveLength(1);
    expect(recheck.events[0].externalAlertId).toBe(suppressed.events[0].externalAlertId);
    expect(recheck.events[0].raw.__alga_condition_recheck).toBe(true);
    await reconcileThroughPipeline(recheck.events);
    const activeAfterMaintenance = await tenantTable('rmm_alerts').where({ tenant: tenantId,
      integration_id: lifecycleIntegrationId, external_alert_id: suppressed.events[0].externalAlertId }).first();
    expect(activeAfterMaintenance.status).toBe('active');
    expect(activeAfterMaintenance.ticket_id).toBeTruthy();
    expect((await tenantTable('rmm_condition_states').where({ tenant: tenantId,
      integration_id: lifecycleIntegrationId, scope_key: lifecycleScope, subject_key: maintenanceSubject,
      condition_key: 'device_offline' }).first()).current_outage_id).toBe(outageBeforeRecheck.current_outage_id);

    // Natural expiry follows the same fresh-evidence recheck path.
    const expiryWindowId = uuidv4();
    const expirySubject = `expiry-${uuidv4()}`;
    const expiryWindowStartsAt = '2026-11-03T12:00:00.000Z';
    const expiryWindowEndsAt = '2026-11-03T12:02:00.000Z';
    const expiryFirstFailureAt = '2026-11-03T12:00:00.000Z';
    const expiryTriggerAt = '2026-11-03T12:01:01.000Z';
    const expiryPostWindowFailureAt = '2026-11-03T12:02:30.000Z';
    await tenantTable('rmm_maintenance_windows').insert({
      tenant: tenantId, window_id: expiryWindowId, integration_id: lifecycleIntegrationId,
      name: 'Expiring lifecycle maintenance', is_active: true,
      starts_at: expiryWindowStartsAt,
      ends_at: expiryWindowEndsAt, recurrence: null,
    });
    await run([observation('failing', expiryFirstFailureAt, expirySubject)], expiryFirstFailureAt);
    const expiryTrigger = await run([observation('failing', expiryTriggerAt, expirySubject)], expiryTriggerAt);
    await reconcileThroughPipeline(expiryTrigger.events);
    const expirySuppressedAlert = await tenantTable('rmm_alerts').where({ tenant: tenantId,
      integration_id: lifecycleIntegrationId, external_alert_id: expiryTrigger.events[0].externalAlertId }).first();
    expect(expirySuppressedAlert.status).toBe('suppressed');
    expect(expirySuppressedAlert.ticket_id).toBeNull();
    const outageBeforeExpiry = await tenantTable('rmm_condition_states').where({ tenant: tenantId,
      integration_id: lifecycleIntegrationId, scope_key: lifecycleScope, subject_key: expirySubject,
      condition_key: 'device_offline' }).first();
    // The fixed observation timeline advances past ends_at while the window
    // stays active, exercising natural expiry rather than deactivation.
    const expiryRecheck = await run([observation('failing', expiryPostWindowFailureAt, expirySubject)], expiryPostWindowFailureAt);
    expect(expiryRecheck.events).toHaveLength(1);
    expect(expiryRecheck.events[0].externalAlertId).toBe(expiryTrigger.events[0].externalAlertId);
    expect(expiryRecheck.events[0].raw.__alga_condition_recheck).toBe(true);
    await reconcileThroughPipeline(expiryRecheck.events);
    const activeAfterExpiry = await tenantTable('rmm_alerts').where({ tenant: tenantId,
      integration_id: lifecycleIntegrationId, external_alert_id: expiryTrigger.events[0].externalAlertId }).first();
    expect(activeAfterExpiry.status).toBe('active');
    expect(activeAfterExpiry.ticket_id).toBeTruthy();
    expect((await tenantTable('rmm_condition_states').where({ tenant: tenantId,
      integration_id: lifecycleIntegrationId, scope_key: lifecycleScope, subject_key: expirySubject,
      condition_key: 'device_offline' }).first()).current_outage_id).toBe(outageBeforeExpiry.current_outage_id);

    // Exercise the real UniFi adapter's per-site results through reconciliation
    // and ticket delivery: healthy responses, empty inventories, uncertainty,
    // failed sites, and mapping removal/remap all retain explicit semantics.
    const adapterScopeA = `host-${uuidv4()}:site-a`;
    const adapterScopeB = `host-${uuidv4()}:site-b`;
    await tenantTable('rmm_organization_mappings').insert([
      { tenant: tenantId, mapping_id: uuidv4(), integration_id: lifecycleIntegrationId,
        external_organization_id: adapterScopeA, external_organization_name: 'Adapter site A',
        client_id: orgOnlyClientId, auto_sync_assets: false, auto_create_tickets: false },
      { tenant: tenantId, mapping_id: uuidv4(), integration_id: lifecycleIntegrationId,
        external_organization_id: adapterScopeB, external_organization_name: 'Adapter site B',
        client_id: orgOnlyClientId, auto_sync_assets: false, auto_create_tickets: false },
    ]);
    await tenantTable('rmm_integrations').where({ tenant: tenantId, integration_id: lifecycleIntegrationId })
      .update({ settings: JSON.stringify({ offlineGraceMinutes: 0, alertPolling: { intervalMinutes: 5 } }) });
    const adapterDevice = (id: string, state: string) => ({
      id, macAddress: null, ipAddress: null, name: id, model: 'USW-Pro-24', serialNumber: null,
      state, firmwareVersion: null, firmwareUpdatable: null, features: ['switching'],
      uplinkDeviceId: null, stateChangedAt: '2026-11-03T12:09:00.000Z', raw: {},
    });
    let adapterPhase: 'initial' | 'empty_and_failed' | 'recover_a' | 'recover_b' | 'uncertain' | 'remapped_failure' | 'remapped_healthy' = 'initial';
    let adapterClock = Date.parse('2026-11-03T12:10:00.000Z');
    const adapter = createUniFiAlertFetcher({
      getKnex: async () => db,
      now: () => { const current = new Date(adapterClock); adapterClock += 1_000; return current; },
      createClient: async () => ({
        listDevices: async (site: any) => {
          if (site.siteId === 'site-b' && ['empty_and_failed', 'recover_a', 'uncertain', 'remapped_failure'].includes(adapterPhase)) {
            throw new Error('simulated site B outage');
          }
          if (site.siteId === 'site-a') {
            if (adapterPhase === 'empty_and_failed') return [];
            if (adapterPhase === 'recover_a' || adapterPhase === 'recover_b') return [adapterDevice('adapter-a-offline', 'ONLINE')];
            if (adapterPhase === 'uncertain') return [adapterDevice('adapter-a-offline', 'UPDATING'), adapterDevice('adapter-unmanaged', 'UPDATING')];
            if (adapterPhase === 'remapped_failure') return [adapterDevice('adapter-unmanaged', 'OFFLINE')];
            if (adapterPhase === 'remapped_healthy') return [adapterDevice('adapter-unmanaged', 'ONLINE')];
            return [adapterDevice('adapter-a-offline', 'OFFLINE'), adapterDevice('adapter-a-uncertain', 'UPDATING'), adapterDevice('adapter-unmanaged', 'OFFLINE')];
          }
          if (adapterPhase === 'recover_b') return [adapterDevice('adapter-b-offline', 'ONLINE')];
          if (adapterPhase === 'initial') return [adapterDevice('adapter-b-offline', 'OFFLINE')];
          return [];
        },
      }),
    });
    registerRmmAlertFetcher('unifi', adapter);
    const adapterPoll = () => runRmmAlertReconciliation(context, {
      tenantId, integrationId: lifecycleIntegrationId, provider: 'unifi',
    });
    await adapterPoll();
    const adapterAState = await tenantTable('rmm_condition_states').where({ tenant: tenantId,
      integration_id: lifecycleIntegrationId, scope_key: adapterScopeA, subject_key: 'adapter-a-offline',
      condition_key: 'device_offline' }).first();
    const adapterBState = await tenantTable('rmm_condition_states').where({ tenant: tenantId,
      integration_id: lifecycleIntegrationId, scope_key: adapterScopeB, subject_key: 'adapter-b-offline',
      condition_key: 'device_offline' }).first();
    const uncertainState = await tenantTable('rmm_condition_states').where({ tenant: tenantId,
      integration_id: lifecycleIntegrationId, scope_key: adapterScopeA, subject_key: 'adapter-a-uncertain',
      condition_key: 'device_offline' }).first();
    expect(adapterAState.state).toBe('firing');
    expect(adapterBState.state).toBe('firing');
    expect(uncertainState.state).toBe('healthy');
    const adapterAAlertId = adapterAState.current_external_alert_id;
    const adapterBAlertId = adapterBState.current_external_alert_id;

    adapterPhase = 'empty_and_failed';
    const missingAndFailed = await adapterPoll();
    expect(missingAndFailed.resetsSynthesized).toBe(0);
    expect(missingAndFailed.remoteActive).toBe(0);
    expect(missingAndFailed.warnings).toEqual([]);
    expect((await tenantTable('rmm_alerts').where({ tenant: tenantId, integration_id: lifecycleIntegrationId,
      external_alert_id: adapterAAlertId }).first()).status).toBe('active');
    expect((await tenantTable('rmm_alerts').where({ tenant: tenantId, integration_id: lifecycleIntegrationId,
      external_alert_id: adapterBAlertId }).first()).status).toBe('active');

    adapterPhase = 'recover_a';
    const siteARecoversWhileBUnavailable = await adapterPoll();
    expect(siteARecoversWhileBUnavailable.resetsSynthesized).toBe(0);
    expect((await tenantTable('rmm_alerts').where({ tenant: tenantId, integration_id: lifecycleIntegrationId,
      external_alert_id: adapterAAlertId }).first()).status).toBe('auto_resolved');
    expect((await tenantTable('rmm_alerts').where({ tenant: tenantId, integration_id: lifecycleIntegrationId,
      external_alert_id: adapterBAlertId }).first()).status).toBe('active');

    // Removing then restoring management while the controller reports an
    // uncertain state keeps the same outage and external alert identity.
    await tenantTable('rmm_organization_mappings').where({ tenant: tenantId, integration_id: lifecycleIntegrationId,
      external_organization_id: adapterScopeA }).delete();
    adapterPhase = 'uncertain';
    await adapterPoll();
    const unmanaged = await tenantTable('rmm_condition_states').where({ tenant: tenantId,
      integration_id: lifecycleIntegrationId, scope_key: adapterScopeA, subject_key: 'adapter-unmanaged',
      condition_key: 'device_offline' }).first();
    expect(unmanaged.state).toBe('unmanaged');
    expect(unmanaged.current_external_alert_id).toBeTruthy();
    const unmanagedAlertId = unmanaged.current_external_alert_id;
    await tenantTable('rmm_organization_mappings').insert({ tenant: tenantId, mapping_id: uuidv4(),
      integration_id: lifecycleIntegrationId, external_organization_id: adapterScopeA,
      external_organization_name: 'Adapter site A', client_id: orgOnlyClientId,
      auto_sync_assets: false, auto_create_tickets: false });
    await adapterPoll();
    const remappedUncertain = await tenantTable('rmm_condition_states').where({ tenant: tenantId,
      integration_id: lifecycleIntegrationId, scope_key: adapterScopeA, subject_key: 'adapter-unmanaged',
      condition_key: 'device_offline' }).first();
    expect(remappedUncertain.current_external_alert_id).toBe(unmanagedAlertId);
    expect(remappedUncertain.current_outage_id).toBe(unmanaged.current_outage_id);
    adapterPhase = 'remapped_failure';
    const undeliveredRemappedFailure = await adapter.fetchActiveAlertSnapshot!({ tenantId, integrationId: lifecycleIntegrationId });
    expect(undeliveredRemappedFailure.events).toHaveLength(0);
    expect(undeliveredRemappedFailure.heldExternalAlertIds).toContain(unmanagedAlertId);
    expect((await tenantTable('rmm_condition_states').where({ tenant: tenantId,
      integration_id: lifecycleIntegrationId, scope_key: adapterScopeA, subject_key: 'adapter-unmanaged',
      condition_key: 'device_offline' }).first()).current_external_alert_id).toBe(unmanagedAlertId);
    adapterPhase = 'remapped_healthy';
    await adapterPoll();
    expect((await tenantTable('rmm_alerts').where({ tenant: tenantId, integration_id: lifecycleIntegrationId,
      external_alert_id: unmanagedAlertId }).first()).status).toBe('auto_resolved');

    adapterPhase = 'recover_b';
    await adapterPoll();
    expect((await tenantTable('rmm_alerts').where({ tenant: tenantId, integration_id: lifecycleIntegrationId,
      external_alert_id: adapterBAlertId }).first()).status).toBe('auto_resolved');
  });

  it('rejects an in-flight maintenance recheck after scope removal without consuming later ticket eligibility', async () => {
    const integration = uuidv4();
    const scope = `recheck-${uuidv4()}`;
    const subject = `device-${uuidv4()}`;
    const rule = uuidv4();
    const window = uuidv4();
    await tenantTable('rmm_integrations').insert({ tenant: tenantId, integration_id: integration,
      provider: `recheck-${integration}`, is_active: true, settings: JSON.stringify({}) });
    await tenantTable('rmm_organization_mappings').insert({ tenant: tenantId, mapping_id: uuidv4(),
      integration_id: integration, external_organization_id: scope, client_id: orgOnlyClientId,
      auto_sync_assets: false, auto_create_tickets: false });
    await tenantTable('rmm_alert_rules').insert({ tenant: tenantId, rule_id: rule,
      integration_id: integration, name: 'Maintenance recheck race', is_active: true,
      priority_order: 0, conditions: JSON.stringify({ activityTypes: ['DEVICE_OFFLINE'] }),
      actions: JSON.stringify({ createTicket: true, boardId, priorityOverride: priorityHighId, autoResolveTicket: true }) });
    await tenantTable('rmm_maintenance_windows').insert({ tenant: tenantId, window_id: window,
      integration_id: integration, name: 'Maintenance recheck race', is_active: true,
      starts_at: '2026-11-03T00:00:00.000Z', ends_at: '2026-11-03T00:03:00.000Z', recurrence: null });

    const makeObservation = (observedAt: string) => ({
      scopeKey: scope, subjectKey: subject, conditionKey: 'device_offline' as const,
      evidence: 'failing' as const, observedAt,
      event: {
        tenantId, integrationId: integration, provider: 'unifi' as const,
        externalDeviceId: subject, conditionIdentity: 'device_offline', activityType: 'DEVICE_OFFLINE',
        alertClass: 'switch', sourceType: 'unifi_device_state', severity: 'major' as const,
        message: 'Review device offline', deviceName: 'Review device', externalOrganizationId: scope,
        raw: { scopeKey: scope, subjectKey: subject, conditionKey: 'device_offline' },
      },
    });
    const observe = (observedAt: string) => reconcileConditionObservations({
      knex: db, tenantId, integrationId: integration, observations: [makeObservation(observedAt)],
      successfulScopes: [scope], graceMs: 0, maxEvidenceGapMs: 300_000, now: new Date(observedAt),
    });
    const deliver = async (events: NormalizedRmmAlertEvent[]) => {
      registerRmmAlertFetcher('unifi', {
        fetchActiveAlerts: async () => events,
        fetchActiveAlertSnapshot: async () => ({ events, heldExternalAlertIds: [] }),
      });
      return runRmmAlertReconciliation({ knex: db }, { tenantId, integrationId: integration, provider: 'unifi' });
    };

    const first = await observe('2026-11-03T00:01:00.000Z');
    expect(first.events).toHaveLength(1);
    const stateBeforeDelivery = await tenantTable('rmm_condition_states').where({ tenant: tenantId,
      integration_id: integration, scope_key: scope, subject_key: subject, condition_key: 'device_offline' }).first();
    expect(stateBeforeDelivery).toMatchObject({
      state: 'firing', current_outage_id: first.events[0].raw.outageId,
      current_external_alert_id: first.events[0].externalAlertId,
    });
    const firstDelivery = await deliver(first.events);
    expect(firstDelivery.ingested).toBe(1);
    expect(firstDelivery.warnings).toEqual([]);
    const outageId = first.events[0].raw.outageId;
    const alertId = first.events[0].externalAlertId;
    const beforeRecheck = await tenantTable('rmm_alerts').where({ tenant: tenantId,
      integration_id: integration, external_alert_id: alertId }).first();
    expect(beforeRecheck.status).toBe('suppressed');
    expect(beforeRecheck.ticket_id).toBeNull();

    await tenantTable('rmm_maintenance_windows').where({ tenant: tenantId, window_id: window })
      .update({ is_active: false });
    const capturedRecheck = await observe('2026-11-03T00:02:00.000Z');
    expect(capturedRecheck.events[0].raw.__alga_condition_recheck).toBe(true);
    const captured = capturedRecheck.events[0];

    // The event was fetched while firing, before a concurrent unmapping wins
    // the condition lock.
    expect(await tenantTable('rmm_condition_states').where({ tenant: tenantId,
      integration_id: integration, scope_key: scope, subject_key: subject,
      condition_key: 'device_offline', current_outage_id: outageId, state: 'firing' }).first('state')).toBeTruthy();
    await tenantTable('rmm_organization_mappings').where({ tenant: tenantId, integration_id: integration,
      external_organization_id: scope }).delete();
    await reconcileConditionObservations({ knex: db, tenantId, integrationId: integration, observations: [],
      successfulScopes: [], unmanagedScopes: [scope], unmanagedObservedAt: '2026-11-03T00:03:00.000Z',
      graceMs: 0, maxEvidenceGapMs: 300_000, now: new Date('2026-11-03T00:03:00.000Z') });

    // Delivery of that previously fetched event must defer under the pipeline's
    // condition lock after unmapping, preserving the pending recheck.
    const stalePipelineResult = await processRmmAlertEvent({ knex: db }, captured, { reprocessSuppressed: true });
    expect(stalePipelineResult.outcome).toBe('deferred');
    await deliver([captured]);
    const stillSuppressed = await tenantTable('rmm_alerts').where({ tenant: tenantId,
      integration_id: integration, external_alert_id: alertId }).first();
    expect(stillSuppressed.status).toBe('suppressed');
    expect(stillSuppressed.ticket_id).toBeNull();

    await tenantTable('rmm_organization_mappings').insert({ tenant: tenantId, mapping_id: uuidv4(),
      integration_id: integration, external_organization_id: scope, client_id: orgOnlyClientId,
      auto_sync_assets: false, auto_create_tickets: false });
    const remappedFailure = await observe('2026-11-03T00:04:00.000Z');
    expect(remappedFailure.events).toHaveLength(1);
    expect(remappedFailure.events[0].externalAlertId).toBe(alertId);
    expect(remappedFailure.events[0].raw.outageId).toBe(outageId);
    expect(remappedFailure.events[0].raw.__alga_condition_recheck).toBe(true);
    await deliver(remappedFailure.events);
    const ticketed = await tenantTable('rmm_alerts').where({ tenant: tenantId,
      integration_id: integration, external_alert_id: alertId }).first();
    expect(ticketed.status).toBe('active');
    expect(ticketed.ticket_id).toBeTruthy();
  });

  it.each(['OFFLINE', 'ONLINE'] as const)(
    'retains an undelivered trigger while unmanaged and resumes with %s evidence',
    async (resumedState) => {
      const integration = uuidv4();
      const scope = `local:pending-${uuidv4()}`;
      const subject = `pending-device-${uuidv4()}`;
      await tenantTable('rmm_integrations').insert({
        tenant: tenantId, integration_id: integration, provider: `pending-${integration}`,
        is_active: true, settings: JSON.stringify({ offlineGraceMinutes: 0 }),
      });
      const mapSite = () => tenantTable('rmm_organization_mappings').insert({
        tenant: tenantId, mapping_id: uuidv4(), integration_id: integration,
        external_organization_id: scope, client_id: orgOnlyClientId,
        auto_sync_assets: false, auto_create_tickets: false,
      });
      await mapSite();
      await tenantTable('rmm_alert_rules').insert({
        tenant: tenantId, rule_id: uuidv4(), integration_id: integration,
        name: 'Pending delivery after remap', is_active: true, priority_order: 0,
        conditions: JSON.stringify({ activityTypes: ['DEVICE_OFFLINE'] }),
        actions: JSON.stringify({ createTicket: true, boardId, priorityOverride: priorityHighId, autoResolveTicket: true }),
      });

      let clock = Date.parse('2026-11-03T15:00:00.000Z');
      let deviceState: string = 'OFFLINE';
      const adapter = createUniFiAlertFetcher({
        getKnex: async () => db,
        now: () => { const now = new Date(clock); clock += 1_000; return now; },
        createClient: async () => ({ listDevices: async () => [{
          id: subject, macAddress: null, ipAddress: null, name: subject, model: 'USW-Pro-24',
          serialNumber: null, state: deviceState, firmwareVersion: null, firmwareUpdatable: null,
          features: ['switching'], uplinkDeviceId: null, stateChangedAt: null, raw: {},
        }] }),
      });
      const args = { tenantId, integrationId: integration };
      const snapshot = () => adapter.fetchActiveAlertSnapshot!(args);
      const published: string[] = [];
      const context = { knex: db, deps: {
        publishRmmAlertEvent: async ({ eventType }: { eventType: string }) => { published.push(eventType); },
      } };
      const deliver = (events: NormalizedRmmAlertEvent[]) => {
        registerRmmAlertFetcher('unifi', {
          fetchActiveAlerts: async () => events,
          fetchActiveAlertSnapshot: async () => ({ events, heldExternalAlertIds: [] }),
        });
        return runRmmAlertReconciliation(context, { ...args, provider: 'unifi' });
      };
      const states = () => tenantTable('rmm_condition_states').where({
        integration_id: integration, scope_key: scope, subject_key: subject, condition_key: 'device_offline',
      });
      const alerts = () => tenantTable('rmm_alerts').where({ integration_id: integration });
      const transitions = () => tenantTable('rmm_condition_transitions').where({ integration_id: integration });

      // Simulate a worker interruption after the trigger commits, before any
      // pipeline delivery. Management removal must defer, rather than lose, it.
      const captured = (await snapshot()).events[0];
      expect(captured.kind).toBe('triggered');
      const transitionId = String(captured.raw.transitionId);
      await tenantTable('rmm_organization_mappings').where({ integration_id: integration }).delete();
      expect((await snapshot()).events).toEqual([]);
      expect((await states().first()).state).toBe('unmanaged');
      expect((await transitions().where({ transition_id: transitionId }).first()).status).toBe('pending');

      // An event already fetched by another poll must also defer inside the
      // pipeline transaction, without publication or outbox acknowledgement.
      expect((await processRmmAlertEvent(context, captured)).outcome).toBe('deferred');
      expect((await deliver([captured])).ingested).toBe(0);
      expect(await alerts()).toHaveLength(0);
      expect(published).toEqual([]);
      expect((await transitions().where({ transition_id: transitionId }).first()).status).toBe('pending');

      await mapSite();
      deviceState = 'UPDATING';
      expect((await snapshot()).events).toEqual([]);
      expect((await deliver([captured])).ingested).toBe(0);
      expect(await alerts()).toHaveLength(0);
      expect((await states().first()).current_external_alert_id).toBe(captured.externalAlertId);
      expect((await transitions().where({ transition_id: transitionId }).first()).status).toBe('pending');

      deviceState = resumedState;
      const resumed = await snapshot();
      if (resumedState === 'OFFLINE') {
        expect(resumed.events).toHaveLength(1);
        expect(resumed.events[0].raw.transitionId).toBe(transitionId);
        expect(resumed.events[0].externalAlertId).toBe(captured.externalAlertId);
        const results = await Promise.all([deliver(resumed.events), deliver(resumed.events)]);
        expect(results.map((result) => result.ingested).sort()).toEqual([0, 1]);
        const ticketed = await alerts().first();
        expect(await alerts()).toHaveLength(1);
        expect(ticketed.ticket_id).toBeTruthy();
        expect((await states().first()).current_outage_id).toBe(captured.raw.outageId);
        expect((await snapshot()).events).toEqual([]);
        expect(await transitions()).toHaveLength(1);

        deviceState = 'ONLINE';
        await deliver((await snapshot()).events);
        const recovered = await alerts().first();
        expect(recovered.status).toBe('auto_resolved');
        expect(recovered.ticket_id).toBe(ticketed.ticket_id);
        expect((await processRmmAlertEvent(context, captured)).outcome).toBe('skipped');
        expect((await alerts().first()).status).toBe('auto_resolved');
      } else {
        // Confirmed recovery supersedes the deferred trigger. Its recovery is
        // drained without ever creating a ticket for an obsolete outage.
        expect(resumed.events.map((event) => event.kind)).toEqual(['reset']);
        await deliver(resumed.events);
        expect(await alerts()).toHaveLength(0);
        expect(published).toEqual([]);
        expect((await processRmmAlertEvent(context, captured)).outcome).toBe('skipped');
      }
      expect((await states().first()).state).toBe('healthy');
      expect((await transitions()).every((row: { status: string }) => row.status === 'delivered')).toBe(true);
    },
  );
});
