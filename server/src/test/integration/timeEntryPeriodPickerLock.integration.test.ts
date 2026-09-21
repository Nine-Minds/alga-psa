/**
 * DB-backed coverage for choosing a period when adding time from a work item.
 *
 * Drives the shipped scheduling actions against the migrated schema:
 *   - a prior period with no sheet is created once on demand and reused,
 *   - a saved entry persists its owner, sheet, period and timezone work_date,
 *   - the write guard rejects locked target/original sheets (including a status
 *     that changes after the sheet was resolved) and out-of-period endpoints,
 *   - rejection leaves both time_entries and bucket_usage untouched,
 *   - another user and another tenant cannot reach the subject's sheets.
 *
 * Required integration coverage for T007.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { randomUUID } from 'node:crypto';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';
import { tenantDb } from '@alga-psa/db';

vi.mock('server/src/lib/utils/getSecret', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => '',
  })),
  secretProvider: {
    getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
      (envVar && process.env[envVar]) || fallback || ''),
  },
}));

vi.mock('@alga-psa/core/logger', () => {
  const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { default: stub, logger: stub };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => {}),
  publishWorkflowEvent: vi.fn(async () => {}),
}));

vi.mock('server/src/lib/eventBus/publishers', () => ({ publishEvent: vi.fn(async () => {}) }));
vi.mock('server/src/lib/eventBus', () => ({ getEventBus: vi.fn(() => ({ publish: vi.fn(async () => {}) })) }));
vi.mock('server/src/lib/analytics/posthog', () => ({ analytics: { capture: vi.fn() } }));

let mockCurrentUser: any = null;

vi.mock('@alga-psa/auth', async () => {
  const rbac = await vi.importActual<typeof import('@alga-psa/auth/rbac')>('@alga-psa/auth/rbac');
  const requireMockUser = () => {
    if (!mockCurrentUser) throw new Error('User not authenticated');
    return mockCurrentUser;
  };
  return {
    ...rbac,
    getSession: vi.fn(async () => ({ user: undefined })),
    withAuth: (action: any) => async (...args: any[]) => {
      const user = requireMockUser();
      const { runWithTenant } = await import('@alga-psa/db');
      return runWithTenant(user.tenant, () => action(user, { tenant: user.tenant }, ...args));
    },
    withOptionalAuth: (action: any) => async (...args: any[]) => {
      const user = mockCurrentUser;
      if (!user) return action(null, null, ...args);
      const { runWithTenant } = await import('@alga-psa/db');
      return runWithTenant(user.tenant, () => action(user, { tenant: user.tenant }, ...args));
    },
    withAuthCheck: (action: any) => async (...args: any[]) => {
      const user = requireMockUser();
      return action(user, ...args);
    },
  };
});

vi.mock('@alga-psa/users/actions', async () => ({
  getCurrentUser: vi.fn(async () => mockCurrentUser),
}));

let db: Knex;
let tenantId: string;
let userId: string;
let otherUserId: string;
let otherTenantId: string;
let otherTenantUserId: string;

let saveTimeEntry: any;
let fetchOrCreateTimeSheet: any;
let fetchTimePeriods: any;

const HISTORICAL_PERIOD = { start: '2026-01-01T00:00:00Z', end: '2026-02-01T00:00:00Z' };
const CURRENT_PERIOD = { start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z' };

interface PoolSeed {
  serviceId: string;
  bucketId: string;
  contractLineId: string;
}

interface ClientSeed {
  clientId: string;
  ticketId: string;
  pool: PoolSeed;
}

async function grantTimeEntryPermissions(connection: Knex, tenant: string, user: string) {
  const scopedDb = tenantDb(connection, tenant);
  const roleId = uuidv4();
  await scopedDb.table('roles').insert({
    tenant,
    role_id: roleId,
    role_name: `Period picker test role ${uuidv4().slice(0, 8)}`,
    description: 'Test role for time-entry period picker integration',
    msp: true,
    client: false,
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });

  for (const perm of [
    { resource: 'time_entry', action: 'create' },
    { resource: 'time_entry', action: 'update' },
  ]) {
    const existing = await scopedDb.table('permissions')
      .where({ resource: perm.resource, action: perm.action })
      .first<{ permission_id: string }>('permission_id');
    const permissionId = existing?.permission_id ?? uuidv4();
    if (!existing) {
      await scopedDb.table('permissions').insert({
        tenant,
        permission_id: permissionId,
        resource: perm.resource,
        action: perm.action,
        msp: true,
        client: false,
        created_at: connection.fn.now(),
      });
    }
    await scopedDb.table('role_permissions')
      .insert({ tenant, role_id: roleId, permission_id: permissionId, created_at: connection.fn.now() })
      .onConflict(['tenant', 'role_id', 'permission_id'])
      .ignore();
  }

  await scopedDb.table('user_roles')
    .insert({ tenant, user_id: user, role_id: roleId, created_at: connection.fn.now() })
    .onConflict(['tenant', 'user_id', 'role_id'])
    .ignore();
}

/** A client covered by a Bucket contract line with one service, plus a ticket. */
async function seedBucketClient(tenant: string): Promise<ClientSeed> {
  const scopedDb = tenantDb(db, tenant);
  const clientId = await createClient(db, tenant, `Period picker client ${uuidv4().slice(0, 6)}`);
  const contractId = randomUUID();
  const contractLineId = randomUUID();

  let serviceTypeId = (await scopedDb.table('service_types').first('id'))?.id;
  if (!serviceTypeId) {
    await scopedDb.table('service_types').insert({
      id: randomUUID(),
      tenant,
      name: `Period picker service type ${uuidv4().slice(0, 6)}`,
      is_active: true,
    });
    serviceTypeId = (await scopedDb.table('service_types').first('id'))?.id;
  }

  await scopedDb.table('contracts').insert({
    tenant,
    contract_id: contractId,
    contract_name: `Period picker contract ${clientId.slice(0, 6)}`,
  });
  await scopedDb.table('contract_lines').insert({
    tenant,
    contract_line_id: contractLineId,
    contract_id: contractId,
    contract_line_name: `Period picker line ${clientId.slice(0, 6)}`,
    contract_line_type: 'Bucket',
    billing_frequency: 'monthly',
    cadence_owner: 'client',
    is_template: false,
    is_active: true,
  });
  await scopedDb.table('client_contracts').insert({
    tenant,
    client_contract_id: randomUUID(),
    client_id: clientId,
    contract_id: contractId,
    start_date: '2026-01-01',
    end_date: null,
    is_active: true,
  });

  const serviceId = randomUUID();
  await scopedDb.table('service_catalog').insert({
    tenant,
    service_id: serviceId,
    service_name: `period-picker-svc-${serviceId.slice(0, 6)}`,
    billing_method: 'hourly',
    custom_service_type_id: serviceTypeId,
  });
  const bucketId = randomUUID();
  await scopedDb.table('contract_line_buckets').insert({
    tenant,
    bucket_id: bucketId,
    contract_line_id: contractLineId,
    total_minutes: 6000,
    overage_rate: 15000,
    allow_rollover: false,
    covers_all_services: false,
  });
  await scopedDb.table('contract_line_bucket_services').insert({
    tenant,
    bucket_id: bucketId,
    contract_line_id: contractLineId,
    service_id: serviceId,
    burn_multiplier: 1,
  });

  const ticketId = randomUUID();
  await scopedDb.table('tickets').insert({
    tenant,
    ticket_id: ticketId,
    ticket_number: `PPT-${uuidv4().slice(0, 6)}`,
    title: `Period picker ticket ${clientId.slice(0, 6)}`,
    client_id: clientId,
  });

  return { clientId, ticketId, pool: { serviceId, bucketId, contractLineId } };
}

async function createPeriod(tenant: string, period: { start: string; end: string }): Promise<string> {
  const periodId = uuidv4();
  await tenantDb(db, tenant).table('time_periods').insert({
    period_id: periodId,
    tenant,
    start_date: period.start,
    end_date: period.end,
  });
  return periodId;
}

async function createSheet(tenant: string, periodId: string, owner: string, status = 'DRAFT'): Promise<string> {
  const id = uuidv4();
  await tenantDb(db, tenant).table('time_sheets').insert({
    id,
    tenant,
    period_id: periodId,
    user_id: owner,
    approval_status: status,
  });
  return id;
}

async function setSheetStatus(tenant: string, sheetId: string, status: string): Promise<void> {
  await tenantDb(db, tenant).table('time_sheets').where({ tenant, id: sheetId }).update({ approval_status: status });
}

async function entryCount(tenant: string): Promise<number> {
  const row = await tenantDb(db, tenant).table('time_entries').count<{ count: string }>('* as count').first();
  return Number(row?.count ?? 0);
}

function toDateOnly(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

async function totalBucketMinutes(tenant: string, clientId: string, bucketId: string): Promise<number> {
  const row = await tenantDb(db, tenant).table('bucket_usage')
    .where({ tenant, client_id: clientId, bucket_id: bucketId })
    .sum<{ total: string | null }>('minutes_used as total')
    .first();
  return Number(row?.total ?? 0);
}

function entryPayload(params: {
  tenant: string;
  client: ClientSeed;
  sheetId: string;
  startIso: string;
  endIso: string;
  billableDuration?: number;
  entryId?: string;
  owner?: string;
  includeSheet?: boolean;
}) {
  return {
    entry_id: params.entryId ?? null,
    work_item_id: params.client.ticketId,
    work_item_type: 'ticket',
    start_time: params.startIso,
    end_time: params.endIso,
    created_at: params.startIso,
    updated_at: params.startIso,
    billable_duration: params.billableDuration ?? 60,
    notes: 'period picker integration',
    user_id: params.owner ?? userId,
    approval_status: 'DRAFT',
    service_id: params.client.pool.serviceId,
    contract_line_id: params.client.pool.contractLineId,
    ...(params.includeSheet === false ? {} : { time_sheet_id: params.sheetId }),
  };
}

describe('time entry period selection against the real database', () => {
  let client: ClientSeed;

  beforeAll(async () => {
    db = await createTestDbConnection();
    tenantId = await createTenant(db, 'Period picker tenant');
    userId = await createUser(db, tenantId, {
      email: `period-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Period',
      last_name: 'Picker',
      user_type: 'internal',
      timezone: 'America/New_York',
    });
    otherUserId = await createUser(db, tenantId, {
      email: `period-other-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Other',
      last_name: 'User',
      user_type: 'internal',
    });
    await grantTimeEntryPermissions(db, tenantId, userId);
    await grantTimeEntryPermissions(db, tenantId, otherUserId);

    otherTenantId = await createTenant(db, 'Period picker other tenant');
    otherTenantUserId = await createUser(db, otherTenantId, {
      email: `period-xtenant-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Cross',
      last_name: 'Tenant',
      user_type: 'internal',
    });
    await grantTimeEntryPermissions(db, otherTenantId, otherTenantUserId);

    client = await seedBucketClient(tenantId);

    mockCurrentUser = { user_id: userId, tenant: tenantId, user_type: 'internal' };
    ({ saveTimeEntry, fetchOrCreateTimeSheet, fetchTimePeriods } = await import(
      '@alga-psa/scheduling/actions/timeEntryActions'
    ));
  }, 180_000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  it('creates a prior period sheet once on demand and reuses it', async () => {
    const periodId = await createPeriod(tenantId, HISTORICAL_PERIOD);

    const first = await fetchOrCreateTimeSheet(userId, periodId);
    expect(first.id).toBeTruthy();
    expect(first.approval_status).toBe('DRAFT');
    expect(first.time_period?.period_id).toBe(periodId);

    const second = await fetchOrCreateTimeSheet(userId, periodId);
    expect(second.id).toBe(first.id);

    const rows = await tenantDb(db, tenantId).table('time_sheets')
      .where({ tenant: tenantId, user_id: userId, period_id: periodId });
    expect(rows).toHaveLength(1);
  });

  it('persists owner, sheet, period and timezone work_date and lets the picker list the status', async () => {
    const periodId = await createPeriod(tenantId, HISTORICAL_PERIOD);
    const sheet = await fetchOrCreateTimeSheet(userId, periodId);

    // 15:00Z is 10:00 in New York, so the work_date is the same calendar day.
    const saved = await saveTimeEntry(entryPayload({
      tenant: tenantId,
      client,
      sheetId: sheet.id,
      startIso: '2026-01-15T15:00:00Z',
      endIso: '2026-01-15T16:00:00Z',
    }));
    expect(saved.entry_id).toBeTruthy();

    const row = await tenantDb(db, tenantId).table('time_entries')
      .where({ tenant: tenantId, entry_id: saved.entry_id })
      .first();
    expect(row.user_id).toBe(userId);
    expect(row.time_sheet_id).toBe(sheet.id);
    expect(toDateOnly(row.work_date)).toBe('2026-01-15');
    expect(row.work_timezone).toBe('America/New_York');

    // The bucket draw proves the entry reached billing, not just the table.
    expect(await totalBucketMinutes(tenantId, client.clientId, client.pool.bucketId)).toBe(60);

    const periods = await fetchTimePeriods(userId);
    const historical = periods.find((period: any) => period.period_id === periodId);
    expect(historical.timeSheetId).toBe(sheet.id);
    expect(historical.timeSheetStatus).toBe('DRAFT');
  });

  it('rejects a created entry on a submitted target sheet and leaves entries and buckets unchanged', async () => {
    const periodId = await createPeriod(tenantId, CURRENT_PERIOD);
    const sheetId = await createSheet(tenantId, periodId, userId, 'SUBMITTED');
    const entriesBefore = await entryCount(tenantId);
    const bucketBefore = await totalBucketMinutes(tenantId, client.clientId, client.pool.bucketId);

    const result = await saveTimeEntry(entryPayload({
      tenant: tenantId,
      client,
      sheetId,
      startIso: '2026-09-10T15:00:00Z',
      endIso: '2026-09-10T16:00:00Z',
    }));

    expect(result.actionError).toContain('locked');
    expect(await entryCount(tenantId)).toBe(entriesBefore);
    expect(await totalBucketMinutes(tenantId, client.clientId, client.pool.bucketId)).toBe(bucketBefore);
  });

  it('rejects a write when the sheet status changes between resolution and save', async () => {
    const periodId = await createPeriod(tenantId, CURRENT_PERIOD);
    const sheetId = await createSheet(tenantId, periodId, userId, 'DRAFT');

    const resolved = await fetchOrCreateTimeSheet(userId, periodId);
    expect(resolved.approval_status).toBe('DRAFT');

    // A concurrent submission locks the sheet after the picker resolved it.
    await setSheetStatus(tenantId, sheetId, 'SUBMITTED');
    const entriesBefore = await entryCount(tenantId);

    const result = await saveTimeEntry(entryPayload({
      tenant: tenantId,
      client,
      sheetId,
      startIso: '2026-09-11T15:00:00Z',
      endIso: '2026-09-11T16:00:00Z',
    }));

    expect(result.actionError).toContain('locked');
    expect(await entryCount(tenantId)).toBe(entriesBefore);
  });

  it('rejects updating an entry whose original sheet is locked and leaves the entry untouched', async () => {
    const periodId = await createPeriod(tenantId, HISTORICAL_PERIOD);
    const sheetId = await createSheet(tenantId, periodId, userId, 'DRAFT');
    const created = await saveTimeEntry(entryPayload({
      tenant: tenantId,
      client,
      sheetId,
      startIso: '2026-01-20T15:00:00Z',
      endIso: '2026-01-20T16:00:00Z',
    }));
    expect(created.entry_id).toBeTruthy();

    await setSheetStatus(tenantId, sheetId, 'APPROVED');
    const bucketBefore = await totalBucketMinutes(tenantId, client.clientId, client.pool.bucketId);

    const result = await saveTimeEntry(entryPayload({
      tenant: tenantId,
      client,
      sheetId,
      entryId: created.entry_id,
      includeSheet: false,
      startIso: '2026-01-20T15:00:00Z',
      endIso: '2026-01-20T17:00:00Z',
      billableDuration: 120,
    }));

    expect(result.actionError).toContain('locked');
    const row = await tenantDb(db, tenantId).table('time_entries')
      .where({ tenant: tenantId, entry_id: created.entry_id })
      .first();
    expect(row.billable_duration).toBe(60);
    expect(await totalBucketMinutes(tenantId, client.clientId, client.pool.bucketId)).toBe(bucketBefore);
  });

  it('rejects out-of-period endpoints without writing an entry or drawing a bucket', async () => {
    const periodId = await createPeriod(tenantId, HISTORICAL_PERIOD);
    const sheetId = await createSheet(tenantId, periodId, userId, 'DRAFT');
    const entriesBefore = await entryCount(tenantId);
    const bucketBefore = await totalBucketMinutes(tenantId, client.clientId, client.pool.bucketId);

    const result = await saveTimeEntry(entryPayload({
      tenant: tenantId,
      client,
      sheetId,
      startIso: '2026-03-10T15:00:00Z',
      endIso: '2026-03-10T16:00:00Z',
    }));

    expect(result.actionError).toContain('must fall within the selected time sheet period');
    expect(await entryCount(tenantId)).toBe(entriesBefore);
    expect(await totalBucketMinutes(tenantId, client.clientId, client.pool.bucketId)).toBe(bucketBefore);
  });

  it('keeps another user in the same tenant out of the subject’s period data and sheets', async () => {
    const periodId = await createPeriod(tenantId, HISTORICAL_PERIOD);
    const sheetId = await createSheet(tenantId, periodId, userId, 'DRAFT');

    mockCurrentUser = { user_id: otherUserId, tenant: tenantId, user_type: 'internal' };

    const periods = await fetchTimePeriods(userId);
    expect(periods.permissionError ?? periods.actionError).toContain('Permission denied');

    const result = await saveTimeEntry({
      entry_id: null,
      work_item_id: client.ticketId,
      work_item_type: 'ticket',
      start_time: '2026-01-22T15:00:00Z',
      end_time: '2026-01-22T16:00:00Z',
      created_at: '2026-01-22T15:00:00Z',
      updated_at: '2026-01-22T15:00:00Z',
      billable_duration: 60,
      notes: 'cross-owner attempt',
      user_id: otherUserId,
      approval_status: 'DRAFT',
      service_id: client.pool.serviceId,
      contract_line_id: client.pool.contractLineId,
      time_sheet_id: sheetId,
    });
    expect(result.actionError).toContain('does not belong');

    mockCurrentUser = { user_id: userId, tenant: tenantId, user_type: 'internal' };
  });

  it('keeps another tenant from resolving the subject tenant’s sheet', async () => {
    const periodId = await createPeriod(tenantId, HISTORICAL_PERIOD);
    const sheetId = await createSheet(tenantId, periodId, userId, 'DRAFT');

    mockCurrentUser = { user_id: otherTenantUserId, tenant: otherTenantId, user_type: 'internal' };

    const foreignClient = await seedBucketClient(otherTenantId);
    const result = await saveTimeEntry({
      entry_id: null,
      work_item_id: foreignClient.ticketId,
      work_item_type: 'ticket',
      start_time: '2026-01-23T15:00:00Z',
      end_time: '2026-01-23T16:00:00Z',
      created_at: '2026-01-23T15:00:00Z',
      updated_at: '2026-01-23T15:00:00Z',
      billable_duration: 60,
      notes: 'cross-tenant attempt',
      user_id: otherTenantUserId,
      approval_status: 'DRAFT',
      service_id: foreignClient.pool.serviceId,
      contract_line_id: foreignClient.pool.contractLineId,
      time_sheet_id: sheetId,
    });
    expect(result.actionError).toContain('Time sheet not found');

    mockCurrentUser = { user_id: userId, tenant: tenantId, user_type: 'internal' };
  });
});
