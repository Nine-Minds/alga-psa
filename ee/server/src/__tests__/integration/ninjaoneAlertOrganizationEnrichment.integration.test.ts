import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '@main-test-utils/dbConfig';
import {
  processRmmAlertEvent,
  registerRmmAlertFetcher,
  runRmmAlertReconciliation,
  type NormalizedRmmAlertEvent,
  type RmmAlertProcessingResult,
} from '@alga-psa/shared/rmm/alerts';
import { ninjaOneAlertFetcher } from '@ee/lib/integrations/ninjaone/alerts/reconciliationFetcher';
import type { NinjaOneAlert } from '@ee/interfaces/ninjaone.interfaces';

/**
 * Regression coverage for org enrichment of sparse polled NinjaOne alerts.
 *
 * Real reconciliation payloads contain `deviceId` but usually no embedded
 * `device` object, so the poller previously dropped the external organization
 * and org-scoped rules rejected otherwise valid alerts before any ticket work.
 * These suites feed the actual sparse API shape through the real NinjaOne
 * fetcher (only the HTTP client is mocked), so normalization -> enrichment ->
 * rule evaluation -> ticket creation are all exercised against the DB.
 */

const HOOK_TIMEOUT = 180_000;

// The NinjaOne client HTTP layer is the only seam mocked: getAlerts() returns
// whatever "the RMM currently reports as active" for the test in flight.
const mockState = vi.hoisted(() => ({
  remoteAlerts: [] as Array<Record<string, unknown>>,
}));

vi.mock('@ee/lib/integrations/ninjaone/ninjaOneClient', () => ({
  createNinjaOneClient: vi.fn(async () => ({
    getAlerts: async () => mockState.remoteAlerts as NinjaOneAlert[],
  })),
}));

let db: Knex;

// Fixture tenants.
const tenantId = uuidv4(); // happy-path + lifecycle (org 500 catch-all rule)
const ruleTenantId = uuidv4(); // keyword/severity/first-match + org exclusions
const forwardOnlyTenantId = uuidv4(); // pre-existing active/acknowledged rows
const otherTenantId = uuidv4(); // isolation: same device ids elsewhere
const integrationId = uuidv4();
const ruleIntegrationId = uuidv4();
const forwardOnlyIntegrationId = uuidv4();

// Reusable IDs per fixture tenant (populated by seedPipelineTenant).
let fixture: Record<string, string> = {};
let ruleFixture: Record<string, string> = {};

// Org-500 catch-all rule for the happy-path/lifecycle tenant. Seeded at file
// level so every suite on that tenant is order-independent.
const allowedRuleId = uuid();

function uuid(): string {
  return uuidv4();
}

function tenantTable(tenant: string, table: string) {
  return tenantDb(db, tenant).table(table);
}

async function hasColumn(table: string, column: string): Promise<boolean> {
  return db.schema.hasColumn(table, column);
}

async function ticketCount(tenant: string): Promise<number> {
  const row = await tenantTable(tenant, 'tickets').where({ tenant }).count('ticket_id as n').first();
  return Number(row?.n ?? 0);
}

/** Sparse NinjaOne alert: a device id, no embedded device object. */
function sparseAlert(overrides: Partial<NinjaOneAlert> = {}): NinjaOneAlert {
  const occurredAt = new Date().toISOString();
  return {
    uid: `cond-${uuid()}`,
    deviceId: 900001,
    severity: 'MAJOR',
    priority: 'HIGH',
    message: 'Disk C: is at 95% capacity',
    createTime: occurredAt,
    sourceType: 'CONDITION',
    sourceConfigUid: `sc-${uuid()}`,
    sourceName: 'DISK_HIGH',
    activityTime: occurredAt,
    data: { statusCode: 'DISK_HIGH' },
    ...overrides,
  } as NinjaOneAlert;
}

/** Insert a tenant row so FKs from child rows resolve. */
async function seedTenantRow(tenant: string, tag: string): Promise<void> {
  await tenantTable(tenant, 'tenants').insert({
    tenant,
    ...((await hasColumn('tenants', 'company_name'))
      ? { company_name: `NinjaOne Org Enrichment ${tag}` }
      : { client_name: `NinjaOne Org Enrichment ${tag}` }),
    email: `ninjaone-enrich-${tag}-${tenant.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

/**
 * Seed the full alert-pipeline fixture (tenant/user/client/boards/statuses/
 * priorities/integration/org mapping). Mirrors rmmAlertPipeline.integration.
 * Returns ids tests assert against.
 */
async function seedPipelineTenant(tenant: string, integration: string, tag: string): Promise<Record<string, string>> {
  const ids: Record<string, string> = {
    tenant,
    integration,
    userId: uuid(),
    clientId: uuid(),
    boardId: uuid(),
    defaultBoardId: uuid(),
    statusOpenId: uuid(),
    statusClosedId: uuid(),
    defaultStatusOpenId: uuid(),
    defaultStatusClosedId: uuid(),
    priorityUrgentId: uuid(),
    priorityHighId: uuid(),
  };

  await seedTenantRow(tenant, tag);

  await tenantTable(tenant, 'users').insert({
    tenant,
    user_id: ids.userId,
    username: `ninjaone-enrich-${tag}-${tenant.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `ninjaone-enrich-user-${tag}-${tenant.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await tenantTable(tenant, 'clients').insert({
    tenant,
    client_id: ids.clientId,
    client_name: `${tag} Co`,
    properties: JSON.stringify({}),
    is_inactive: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await tenantTable(tenant, 'boards').insert([
    { tenant, board_id: ids.boardId, board_name: `${tag} Alerts`, is_default: false },
    { tenant, board_id: ids.defaultBoardId, board_name: `${tag} General`, is_default: true },
  ]);

  const statusItemType = {
    ...((await hasColumn('statuses', 'item_type')) ? { item_type: 'ticket' } : {}),
    ...((await hasColumn('statuses', 'status_type')) ? { status_type: 'ticket' } : {}),
  };
  await tenantTable(tenant, 'statuses').insert([
    {
      tenant,
      status_id: ids.statusOpenId,
      name: 'Open',
      ...statusItemType,
      board_id: ids.boardId,
      is_closed: false,
      is_default: true,
      order_number: 10,
      created_by: ids.userId,
    },
    {
      tenant,
      status_id: ids.statusClosedId,
      name: 'Closed',
      ...statusItemType,
      board_id: ids.boardId,
      is_closed: true,
      is_default: false,
      order_number: 20,
      created_by: ids.userId,
    },
    {
      tenant,
      status_id: ids.defaultStatusOpenId,
      name: 'Open',
      ...statusItemType,
      board_id: ids.defaultBoardId,
      is_closed: false,
      is_default: true,
      order_number: 10,
      created_by: ids.userId,
    },
    {
      tenant,
      status_id: ids.defaultStatusClosedId,
      name: 'Closed',
      ...statusItemType,
      board_id: ids.defaultBoardId,
      is_closed: true,
      is_default: false,
      order_number: 20,
      created_by: ids.userId,
    },
  ]);

  await tenantTable(tenant, 'priorities').insert(
    [
      { id: ids.priorityUrgentId, name: 'Urgent', order: 1 },
      { id: ids.priorityHighId, name: 'High', order: 2 },
    ].map((p) => ({
      tenant,
      priority_id: p.id,
      priority_name: p.name,
      item_type: 'ticket',
      order_number: p.order,
      color: '#888888',
      created_by: ids.userId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }))
  );

  await tenantTable(tenant, 'rmm_integrations').insert({
    tenant,
    integration_id: integration,
    provider: 'ninjaone',
    instance_url: 'https://app.ninjarmm.com',
    is_active: true,
    connected_at: db.fn.now(),
    settings: JSON.stringify({}),
  });

  // External organization 500 maps to the fixture client.
  await tenantTable(tenant, 'rmm_organization_mappings').insert({
    tenant,
    mapping_id: uuid(),
    integration_id: integration,
    external_organization_id: '500',
    external_organization_name: `${tag} Org`,
    client_id: ids.clientId,
    default_contact_id: null,
    auto_sync_assets: false,
    auto_create_tickets: false,
  });

  return ids;
}

/** Seed an asset (optionally under a client) plus a ninjaone device mapping. */
async function seedMappedAsset(
  tenant: string,
  clientId: string,
  deviceId: string | number,
  realm: string | null,
  assetId = uuid(),
  integration_type = 'ninjaone'
): Promise<void> {
  const asset = assetId;
  await tenantTable(tenant, 'assets').insert({
    tenant,
    asset_id: asset,
    asset_type: 'server',
    name: `node-${deviceId}`,
    asset_tag: `tag-${deviceId}`,
    serial_number: `sn-${deviceId}`,
    status: 'active',
    client_id: clientId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await tenantTable(tenant, 'tenant_external_entity_mappings').insert({
    tenant,
    id: uuid(),
    integration_type,
    alga_entity_type: 'asset',
    alga_entity_id: asset,
    external_entity_id: String(deviceId),
    external_realm_id: realm,
    sync_status: 'synced',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

/** Seed a device mapping row without an asset (enrichment-only evidence). */
async function seedDeviceMapping(
  tenant: string,
  deviceId: string | number,
  realm: string | null,
  integration_type = 'ninjaone',
  algaEntityId = uuid()
): Promise<void> {
  await tenantTable(tenant, 'tenant_external_entity_mappings').insert({
    tenant,
    id: uuid(),
    integration_type,
    alga_entity_type: 'asset',
    alga_entity_id: algaEntityId,
    external_entity_id: String(deviceId),
    external_realm_id: realm,
    sync_status: 'synced',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function seedRule(
  tenant: string,
  integration: string,
  ruleId: string,
  name: string,
  priorityOrder: number,
  conditions: Record<string, unknown>,
  actions: Record<string, unknown>
): Promise<void> {
  await tenantTable(tenant, 'rmm_alert_rules').insert({
    tenant,
    rule_id: ruleId,
    integration_id: integration,
    name,
    is_active: true,
    priority_order: priorityOrder,
    conditions: JSON.stringify(conditions),
    actions: JSON.stringify(actions),
  });
}

async function fetchAndProcess(
  tenant: string,
  integration: string,
  alerts: NinjaOneAlert[]
): Promise<RmmAlertProcessingResult[]> {
  mockState.remoteAlerts = alerts;
  const events = await ninjaOneAlertFetcher.fetchActiveAlerts({ tenantId: tenant, integrationId: integration });
  const results: RmmAlertProcessingResult[] = [];
  for (const event of events) {
    results.push(await processRmmAlertEvent({ knex: db }, event));
  }
  return results;
}

const CLEANUP_TABLES = [
  'comments',
  'comment_threads',
  'asset_associations',
  'time_entries',
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
];

async function cleanupTenant(tenant: string): Promise<void> {
  for (const table of CLEANUP_TABLES) {
    await tenantTable(tenant, table)
      .where({ tenant })
      .del()
      .catch(() => undefined);
  }
}

beforeAll(async () => {
  process.env.DB_PORT = process.env.DB_PORT || '5432';
  process.env.APP_ENV = process.env.APP_ENV || 'test';
  db = await createTestDbConnection();

  fixture = await seedPipelineTenant(tenantId, integrationId, 'Happy');
  ruleFixture = await seedPipelineTenant(ruleTenantId, ruleIntegrationId, 'Rules');

  // The org-500 rule every tenantId alert-pipeline suite relies on.
  await seedRule(
    tenantId,
    integrationId,
    allowedRuleId,
    'Org 500 alerts',
    0,
    { organizationIds: ['500'], severities: ['critical', 'major', 'moderate', 'minor'] },
    {
      createTicket: true,
      boardId: fixture.boardId,
      priorityOverride: fixture.priorityUrgentId,
      assignToUserId: fixture.userId,
      autoResolveTicket: true,
      resetAlertOnTicketClose: true,
    }
  );

  await seedTenantRow(forwardOnlyTenantId, 'Forward');
  await seedTenantRow(otherTenantId, 'Other');

  // The real NinjaOne fetcher drives every reconciliation in this file; the
  // NinjaOne client HTTP layer is mocked above.
  registerRmmAlertFetcher('ninjaone', ninjaOneAlertFetcher);
}, HOOK_TIMEOUT);

afterAll(async () => {
  if (!db) return;
  for (const tenant of [tenantId, ruleTenantId, forwardOnlyTenantId, otherTenantId]) {
    await cleanupTenant(tenant);
  }
  await db.destroy().catch(() => undefined);
}, HOOK_TIMEOUT);

describe('sparse NinjaOne alert normalization + organization enrichment', { shuffle: false }, () => {
  // Devices on the happy-path tenant: 900001 maps to org 500; 900002 also maps
  // to 500 but the payload carries an explicit device organization (501);
  // 900003 is unmapped; 900004 is ambiguous (two distinct realms); 900005 maps
  // with a null realm; 900006 only has a tacticalrmm mapping; 900007 only has
  // a mapping in another tenant; 900008 maps to a single realm 500.
  beforeAll(async () => {
    await seedDeviceMapping(tenantId, 900001, '500', 'ninjaone', uuid());
    await seedDeviceMapping(tenantId, 900002, '500', 'ninjaone', uuid());
    // 900003: no mapping at all.
    await seedDeviceMapping(tenantId, 900004, '500', 'ninjaone', uuid());
    await seedDeviceMapping(tenantId, 900004, '501', 'ninjaone', uuid());
    await seedDeviceMapping(tenantId, 900005, null, 'ninjaone', uuid());
    await seedDeviceMapping(tenantId, 900006, '500', 'tacticalrmm', uuid());
    await seedDeviceMapping(otherTenantId, 900007, '500', 'ninjaone', uuid());
    await seedDeviceMapping(tenantId, 900008, '500', 'ninjaone', uuid());
  }, HOOK_TIMEOUT);

  it('enriches a sparse payload from a single mapped realm and preserves order and other fields', async () => {
    const alerts: NinjaOneAlert[] = [
      sparseAlert({ uid: 'adapter-a', deviceId: 900001, message: 'disk-a' }),
      sparseAlert({ uid: 'adapter-b', deviceId: 900008, message: 'disk-b' }),
      sparseAlert({ uid: 'adapter-c', deviceId: 900003, message: 'disk-c' }),
    ];
    mockState.remoteAlerts = alerts;
    const events = await ninjaOneAlertFetcher.fetchActiveAlerts({ tenantId, integrationId });

    expect(events.map((e) => e.externalAlertId)).toEqual(['adapter-a', 'adapter-b', 'adapter-c']);
    expect(events.map((e) => e.externalOrganizationId)).toEqual(['500', '500', null]);
    expect(events.map((e) => e.externalDeviceId)).toEqual(['900001', '900008', '900003']);
    expect(events[0].message).toBe('disk-a');
    expect(events[0].severity).toBe('major');
    expect(events[0].conditionIdentity).toBe('DISK_HIGH');
  });

  it('preserves an explicit provider organization id and never overwrites it with the mapped realm', async () => {
    const alert = sparseAlert({
      uid: 'adapter-explicit',
      deviceId: 900002,
      message: 'explicit',
      device: { id: 900002, organizationId: 501 } as unknown as NinjaOneAlert['device'],
    });
    mockState.remoteAlerts = [alert];
    const events = await ninjaOneAlertFetcher.fetchActiveAlerts({ tenantId, integrationId });
    expect(events).toHaveLength(1);
    expect(events[0].externalDeviceId).toBe('900002');
    expect(events[0].externalOrganizationId).toBe('501'); // not '500'
  });

  it('leaves missing, null-realm, ambiguous, cross-provider, and cross-tenant devices unresolved', async () => {
    const alerts: NinjaOneAlert[] = [
      sparseAlert({ uid: 'adapter-missing', deviceId: 900003, message: 'no mapping' }),
      sparseAlert({ uid: 'adapter-null', deviceId: 900005, message: 'null realm' }),
      sparseAlert({ uid: 'adapter-ambiguous', deviceId: 900004, message: 'two realms' }),
      sparseAlert({ uid: 'adapter-cross-provider', deviceId: 900006, message: 'tactical only' }),
      sparseAlert({ uid: 'adapter-cross-tenant', deviceId: 900007, message: 'other tenant only' }),
    ];
    mockState.remoteAlerts = alerts;
    const events = await ninjaOneAlertFetcher.fetchActiveAlerts({ tenantId, integrationId });

    expect(events).toHaveLength(5);
    for (const event of events) {
      expect(event.externalOrganizationId).toBeNull();
    }
  });
});

describe('enriched sparse alerts reach the normal ticket pipeline', { shuffle: false }, () => {
  const happyDevice = 900100;
  const happyCondition = 'DISK_HIGH';

  // Keep the RMM "currently active" list stable across reconciliation cycles
  // so earlier poller-ingested rows are not synthesized as resets.
  const remoteAlerts: NinjaOneAlert[] = [];
  const happyAlert = () =>
    sparseAlert({
      uid: 'happy-sparse-1',
      deviceId: happyDevice,
      sourceName: happyCondition,
      data: { statusCode: happyCondition },
      message: 'Disk full on happy host',
    });

  beforeAll(async () => {
    await seedMappedAsset(tenantId, fixture.clientId, happyDevice, '500');
    remoteAlerts.push(happyAlert());
    mockState.remoteAlerts = remoteAlerts;
  }, HOOK_TIMEOUT);

  it('a fresh sparse polled alert maps to org 500 and creates a linked ticket on the configured board', async () => {
    const before = await ticketCount(tenantId);
    const result = await runRmmAlertReconciliation(
      { knex: db },
      { tenantId, integrationId, provider: 'ninjaone' }
    );

    expect(result.skipped).toBe(false);
    expect(result.remoteActive).toBe(1);
    expect(result.ingested).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(await ticketCount(tenantId)).toBe(before + 1);

    const alertRow = await tenantTable(tenantId, 'rmm_alerts')
      .where({ tenant: tenantId, integration_id: integrationId, external_alert_id: 'happy-sparse-1' })
      .first();
    expect(alertRow).not.toBeNull();
    expect(alertRow.status).toBe('active');
    expect(alertRow.matched_rule_id).toBe(allowedRuleId);
    expect(alertRow.asset_id).not.toBeNull();
    expect(alertRow.ticket_id).not.toBeNull();
    expect(alertRow.metadata).toMatchObject({ __alga_ingest_source: 'reconciliation' });

    const ticket = await tenantTable(tenantId, 'tickets')
      .where({ tenant: tenantId, ticket_id: alertRow.ticket_id })
      .first();
    expect(ticket.board_id).toBe(fixture.boardId);
    expect(ticket.assigned_to).toBe(fixture.userId);
    expect(ticket.priority_id).toBe(fixture.priorityUrgentId);
    expect(ticket.client_id).toBe(fixture.clientId);
    expect(ticket.source).toBe('ninjaone');
    expect(String(ticket.status_id)).toBe(String(fixture.statusOpenId));
  });

  it('redelivering the same active alert creates no duplicate ticket', async () => {
    const before = await ticketCount(tenantId);
    const result = await runRmmAlertReconciliation(
      { knex: db },
      { tenantId, integrationId, provider: 'ninjaone' }
    );
    expect(result.ingested).toBe(0); // duplicate skip for the active row
    expect(await ticketCount(tenantId)).toBe(before);
    const rows = await tenantTable(tenantId, 'rmm_alerts')
      .where({ tenant: tenantId, external_alert_id: 'happy-sparse-1' });
    expect(rows).toHaveLength(1);
  });
});

describe('forward-only guard: pre-existing active/acknowledged rows without tickets stay skipped', { shuffle: false }, () => {
  const activeExtId = 'pre-existing-active';
  const ackExtId = 'pre-existing-ack';
  const activeDeviceId = 901001;
  const ackDeviceId = 901002;

  beforeAll(async () => {
    // rmm_alerts carries an FK to rmm_integrations (tenant, integration_id).
    await tenantTable(forwardOnlyTenantId, 'rmm_integrations').insert({
      tenant: forwardOnlyTenantId,
      integration_id: forwardOnlyIntegrationId,
      provider: 'ninjaone',
      instance_url: 'https://app.ninjarmm.com',
      is_active: true,
      connected_at: db.fn.now(),
      settings: JSON.stringify({}),
    });

    // Rows that predate the fix: active/acknowledged, no ticket, no rule
    // would ever have run for them. They carry the poller ingest marker, so
    // they are exactly the kind of row a backfill would have touched.
    const now = new Date().toISOString();
    const seedRow = async (alertId: string, extAlertId: string, extDevice: number, status: string, ack?: boolean) => {
      await tenantTable(forwardOnlyTenantId, 'rmm_alerts').insert({
        tenant: forwardOnlyTenantId,
        alert_id: alertId,
        integration_id: forwardOnlyIntegrationId,
        external_alert_id: extAlertId,
        external_device_id: String(extDevice),
        asset_id: null,
        severity: 'major',
        status,
        source_type: 'condition',
        alert_class: 'DISK_HIGH',
        message: `pre-existing ${status}`,
        dedup_key: `${extDevice}|DISK_HIGH`,
        triggered_at: now,
        last_occurrence_at: now,
        acknowledged_at: ack ? now : null,
        metadata: JSON.stringify({ __alga_ingest_source: 'reconciliation' }),
        created_at: now,
        updated_at: now,
      });
    };
    await seedRow(uuid(), activeExtId, activeDeviceId, 'active');
    await seedRow(uuid(), ackExtId, ackDeviceId, 'acknowledged', true);
  }, HOOK_TIMEOUT);

  it('reconciliation leaves both rows untouched and creates no retroactive tickets', async () => {
    mockState.remoteAlerts = [
      sparseAlert({ uid: activeExtId, deviceId: activeDeviceId, sourceName: 'DISK_HIGH', data: { statusCode: 'DISK_HIGH' } }),
      sparseAlert({ uid: ackExtId, deviceId: ackDeviceId, sourceName: 'DISK_HIGH', data: { statusCode: 'DISK_HIGH' } }),
    ];
    const before = await ticketCount(forwardOnlyTenantId);
    const result = await runRmmAlertReconciliation(
      { knex: db },
      { tenantId: forwardOnlyTenantId, integrationId: forwardOnlyIntegrationId, provider: 'ninjaone' }
    );

    expect(result.ingested).toBe(0);
    expect(result.resetsSynthesized).toBe(0);
    expect(await ticketCount(forwardOnlyTenantId)).toBe(before);

    const activeRow = await tenantTable(forwardOnlyTenantId, 'rmm_alerts')
      .where({ tenant: forwardOnlyTenantId, external_alert_id: activeExtId })
      .first();
    const ackRow = await tenantTable(forwardOnlyTenantId, 'rmm_alerts')
      .where({ tenant: forwardOnlyTenantId, external_alert_id: ackExtId })
      .first();
    expect(activeRow.status).toBe('active');
    expect(activeRow.ticket_id).toBeNull();
    expect(ackRow.status).toBe('acknowledged');
    expect(ackRow.ticket_id).toBeNull();
  });
});

describe('rule behavior on enriched sparse alerts', { shuffle: false }, () => {
  const ruleADevice = 902001;
  const ruleBDevice = 902002;
  const org6Device = 902006;
  const org7Device = 902007;
  const crossTenantDevice = 902008;
  const ruleAId = uuid();
  const ruleBId = uuid();

  beforeAll(async () => {
    const clientId = ruleFixture.clientId;
    await seedMappedAsset(ruleTenantId, clientId, ruleADevice, '500');
    await seedMappedAsset(ruleTenantId, clientId, ruleBDevice, '500');
    await seedDeviceMapping(ruleTenantId, org6Device, '6');
    await seedDeviceMapping(ruleTenantId, org7Device, '7');
    // This device has a mapping only in another tenant; it must stay unresolved.
    await seedDeviceMapping(otherTenantId, crossTenantDevice, '500');

    // First-match priority: rule A is higher priority than rule B; both are
    // org-scoped. Severity and keyword conditions gate each rule.
    await seedRule(
      ruleTenantId,
      ruleIntegrationId,
      ruleAId,
      'Disk rule',
      0,
      { organizationIds: ['500'], severities: ['critical', 'major'], keywords: ['disk'] },
      {
        createTicket: true,
        boardId: ruleFixture.boardId,
        assignToUserId: ruleFixture.userId,
        ticketTemplate: { titleTemplate: '[RuleA] {{message}}' },
        autoResolveTicket: true,
      }
    );
    await seedRule(
      ruleTenantId,
      ruleIntegrationId,
      ruleBId,
      'CPU rule',
      1,
      { organizationIds: ['500'], severities: ['critical', 'major'], keywords: ['cpu'] },
      {
        createTicket: true,
        boardId: ruleFixture.boardId,
        assignToUserId: ruleFixture.userId,
        autoResolveTicket: true,
      }
    );
  }, HOOK_TIMEOUT);

  it('enriched org-500 alert matches the disk rule by keyword + severity and creates a ticket', async () => {
    const before = await ticketCount(ruleTenantId);
    const results = await fetchAndProcess(ruleTenantId, ruleIntegrationId, [
      sparseAlert({ uid: 'rule-a', deviceId: ruleADevice, sourceName: 'DISK_HIGH', data: { statusCode: 'DISK_HIGH' }, message: 'disk nearly full' }),
    ]);
    expect(results[0].outcome).toBe('ticket_created');
    expect(results[0].matchedRuleId).toBe(ruleAId);
    expect(await ticketCount(ruleTenantId)).toBe(before + 1);
    const ticket = await tenantTable(ruleTenantId, 'tickets')
      .where({ tenant: ruleTenantId, ticket_id: results[0].ticketId! })
      .first();
    expect(ticket.board_id).toBe(ruleFixture.boardId);
    expect(ticket.assigned_to).toBe(ruleFixture.userId);
    expect(ticket.title).toBe('[RuleA] disk nearly full');
  });

  it('severity outside the rule gates the alert to record-only (no ticket)', async () => {
    const before = await ticketCount(ruleTenantId);
    const results = await fetchAndProcess(ruleTenantId, ruleIntegrationId, [
      sparseAlert({ uid: 'rule-sev', deviceId: ruleADevice, severity: 'NONE', sourceName: 'DISK_HIGH', data: { statusCode: 'DISK_HIGH' }, message: 'disk noise' }),
    ]);
    expect(results[0].outcome).toBe('recorded_only');
    expect(await ticketCount(ruleTenantId)).toBe(before);
  });

  it('a keyword miss leaves the alert recorded without a ticket', async () => {
    const before = await ticketCount(ruleTenantId);
    const results = await fetchAndProcess(ruleTenantId, ruleIntegrationId, [
      sparseAlert({ uid: 'rule-keyword', deviceId: ruleBDevice, sourceName: 'OTHER', data: { statusCode: 'OTHER' }, message: 'backup job failed' }),
    ]);
    expect(results[0].outcome).toBe('recorded_only');
    expect(await ticketCount(ruleTenantId)).toBe(before);
  });

  it('first-match priority picks the higher-priority rule when several match', async () => {
    const before = await ticketCount(ruleTenantId);
    const results = await fetchAndProcess(ruleTenantId, ruleIntegrationId, [
      sparseAlert({ uid: 'rule-firstmatch', deviceId: ruleBDevice, sourceName: 'BOTH', data: { statusCode: 'BOTH' }, message: 'disk and cpu both hot' }),
    ]);
    expect(results[0].outcome).toBe('ticket_created');
    expect(results[0].matchedRuleId).toBe(ruleAId); // priority 0 wins over priority 1
    expect(await ticketCount(ruleTenantId)).toBe(before + 1);
  });

  it('organizations 6 and 7 remain excluded and cannot create tickets', async () => {
    const before = await ticketCount(ruleTenantId);
    const results = await fetchAndProcess(ruleTenantId, ruleIntegrationId, [
      sparseAlert({ uid: 'org6', deviceId: org6Device, sourceName: 'DISK_HIGH', data: { statusCode: 'DISK_HIGH' }, message: 'disk nearly full' }),
      sparseAlert({ uid: 'org7', deviceId: org7Device, sourceName: 'DISK_HIGH', data: { statusCode: 'DISK_HIGH' }, message: 'disk nearly full' }),
    ]);
    expect(results[0].outcome).toBe('recorded_only');
    expect(results[1].outcome).toBe('recorded_only');
    expect(await ticketCount(ruleTenantId)).toBe(before);
  });

  it('a device mapped only in another tenant cannot supply an organization-scoped ticket', async () => {
    const before = await ticketCount(ruleTenantId);
    const results = await fetchAndProcess(ruleTenantId, ruleIntegrationId, [
      sparseAlert({ uid: 'cross-tenant', deviceId: crossTenantDevice, sourceName: 'DISK_HIGH', data: { statusCode: 'DISK_HIGH' }, message: 'disk nearly full' }),
    ]);
    // Enrichment must fail closed, so the org-scoped rule cannot match.
    expect(results[0].outcome).toBe('recorded_only');
    expect(results[0].matchedRuleId).toBeNull();
    expect(await ticketCount(ruleTenantId)).toBe(before);
  });
});

describe('lifecycle regressions on enriched sparse alerts', { shuffle: false }, () => {
  // Each scenario owns its device + external alert ids and never re-runs a
  // reconciliation cycle over the shared happy-path integration afterwards,
  // so rows stay independent.
  const suppressionDevice = 903001;
  const retriggerDevice = 903002;
  const windowId = uuid();

  const now = new Date().toISOString();

  function resetEvent(tenant: string, integration: string, externalAlertId: string): NormalizedRmmAlertEvent {
    return {
      tenantId: tenant,
      integrationId: integration,
      provider: 'ninjaone',
      kind: 'reset',
      externalAlertId,
      severity: 'none',
      occurredAt: now,
      raw: {},
    };
  }

  beforeAll(async () => {
    await seedMappedAsset(tenantId, fixture.clientId, suppressionDevice, '500');
    await seedMappedAsset(tenantId, fixture.clientId, retriggerDevice, '500');
  }, HOOK_TIMEOUT);

  it('suppresses an enriched sparse alert inside a maintenance window, then tickets it once the window ends', async () => {
    const windowStart = new Date();
    await tenantTable(tenantId, 'rmm_maintenance_windows').insert({
      tenant: tenantId,
      window_id: windowId,
      integration_id: integrationId,
      client_id: null,
      asset_id: null,
      name: 'Enrichment window',
      is_active: true,
      starts_at: new Date(windowStart.getTime() - 60_000).toISOString(),
      ends_at: new Date(windowStart.getTime() + 3_600_000).toISOString(),
      recurrence: null,
    });

    // The RMM only reports this one alert as active. The happy-path poller row
    // (happy-sparse-1) is intentionally absent here; reconciliation synthesizes
    // its reset, which is normal lifecycle behavior for an alert that stopped
    // firing in the RMM.
    const sparse = sparseAlert({ uid: 'window-sparse', deviceId: suppressionDevice, sourceName: 'WINDOW_COND', data: { statusCode: 'WINDOW_COND' }, message: 'window cond' });
    mockState.remoteAlerts = [sparse];
    let result = await runRmmAlertReconciliation({ knex: db }, { tenantId, integrationId, provider: 'ninjaone' });
    expect(result.warnings).toEqual([]);
    const suppressed = await tenantTable(tenantId, 'rmm_alerts')
      .where({ tenant: tenantId, external_alert_id: 'window-sparse' })
      .first();
    expect(suppressed.status).toBe('suppressed');
    expect(suppressed.ticket_id).toBeNull();
    expect(suppressed.suppressed_by_window_id).toBe(windowId);

    // Window ends while the condition is still firing.
    await tenantTable(tenantId, 'rmm_maintenance_windows')
      .where({ tenant: tenantId, window_id: windowId })
      .update({ is_active: false });

    result = await runRmmAlertReconciliation({ knex: db }, { tenantId, integrationId, provider: 'ninjaone' });
    expect(result.warnings).toEqual([]);
    const reactivated = await tenantTable(tenantId, 'rmm_alerts')
      .where({ tenant: tenantId, external_alert_id: 'window-sparse' })
      .first();
    expect(reactivated.status).toBe('active');
    expect(reactivated.ticket_id).not.toBeNull();
  });

  it('a reset resolves the enriched alert and a later firing creates a fresh ticket', async () => {
    const firedResults = await fetchAndProcess(tenantId, integrationId, [
      sparseAlert({ uid: 'rt-1', deviceId: retriggerDevice, sourceName: 'SVC_DOWN', data: { statusCode: 'SVC_DOWN' }, message: 'service down' }),
    ]);
    expect(firedResults[0].outcome).toBe('ticket_created');

    const reset = await processRmmAlertEvent(
      { knex: db },
      resetEvent(tenantId, integrationId, 'rt-1')
    );
    expect(reset.outcome).toBe('resolved');

    const resolved = await tenantTable(tenantId, 'rmm_alerts')
      .where({ tenant: tenantId, alert_id: firedResults[0].alertId! })
      .first();
    expect(['resolved', 'auto_resolved']).toContain(resolved.status);

    // Same condition re-fires under a new external alert id after the ticket
    // closed: a new ticket opens (no open sibling to absorb it).
    const before = await ticketCount(tenantId);
    const refire = await fetchAndProcess(tenantId, integrationId, [
      sparseAlert({ uid: 'rt-2', deviceId: retriggerDevice, sourceName: 'SVC_DOWN', data: { statusCode: 'SVC_DOWN' }, message: 'service down again' }),
    ]);
    expect(refire[0].outcome).toBe('ticket_created');
    expect(await ticketCount(tenantId)).toBe(before + 1);
  });

  it('a repeat firing of an open condition appends to the open ticket instead of duplicating', async () => {
    const open = await tenantTable(tenantId, 'rmm_alerts')
      .where({ tenant: tenantId, external_alert_id: 'rt-2' })
      .first();
    expect(open).not.toBeNull();
    const before = await ticketCount(tenantId);
    const results = await fetchAndProcess(tenantId, integrationId, [
      sparseAlert({ uid: 'rt-3', deviceId: retriggerDevice, sourceName: 'SVC_DOWN', data: { statusCode: 'SVC_DOWN' }, message: 'service down yet again' }),
    ]);
    expect(results[0].outcome).toBe('occurrence_appended');
    expect(results[0].ticketId).toBe(open.ticket_id);
    expect(await ticketCount(tenantId)).toBe(before);
  });
});
