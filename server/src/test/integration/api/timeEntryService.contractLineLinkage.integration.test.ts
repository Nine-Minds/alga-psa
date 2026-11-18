/**
 * REST TimeEntryService create/update contract-line linkage against real tables (alga0002015).
 *
 * Drives TimeEntryService.create / .update (the code behind POST/PATCH /api/v1/time-entries) through the
 * shared persistTimeEntry core and asserts the stored time_entries row and the bucket_usage rows.
 *
 * Runs against a dedicated database (never the shared default) on the local test Postgres:
 *   DB_HOST=127.0.0.1 DB_PORT=5472 via wireLocalTestDbEnv(), database `alga0002015_time_entry_linkage`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../test-utils/dbConfig';
import { createClient, createTenant } from '../../../../test-utils/testDataFactory';
import { runWithTenant, tenantDb } from '@alga-psa/db';
import { ValidationError } from '../../../lib/api/middleware/apiMiddleware';
import { TimeEntryService } from '../../../lib/api/services/TimeEntryService';
import { createPeriod, createStopwatchUser } from '../stopwatch/stopwatchTestSeed';

const TEST_DB = 'alga0002015_time_entry_linkage';

vi.mock('server/src/lib/utils/getSecret', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
  getSecretProviderInstance: vi.fn(async () => ({ getAppSecret: async () => '' })),
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
const publishers = vi.hoisted(() => ({
  publishEvent: vi.fn(async () => {}),
  publishWorkflowEvent: vi.fn(async () => {}),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/event-bus/publishers', () => publishers);
vi.mock('server/src/lib/eventBus/publishers', () => publishers);
vi.mock('server/src/lib/eventBus', () => ({ getEventBus: vi.fn(() => ({ publish: vi.fn(async () => {}) })) }));
vi.mock('server/src/lib/analytics/posthog', () => ({ analytics: { capture: vi.fn() } }));
vi.mock('@alga-psa/auth', async () => {
  const rbac = await vi.importActual<typeof import('@alga-psa/auth/rbac')>('@alga-psa/auth/rbac');
  const passthrough = (action: any) => async (...args: any[]) => action(null, { tenant: null }, ...args);
  return {
    ...rbac,
    getSession: vi.fn(async () => ({ user: undefined })),
    withAuth: passthrough,
    withOptionalAuth: passthrough,
    withAuthCheck: (action: any) => async (...args: any[]) => action(null, ...args),
  };
});

let db: Knex;
let tenantId: string;
let serviceId: string;
let serviceTypeId: string;
const service = new TimeEntryService();

const asTenant = <T>(fn: () => Promise<T>) => runWithTenant(tenantId, fn);

async function ctxFor(userId: string): Promise<any> {
  const row = await tenantDb(db, tenantId).table('users').where({ user_id: userId }).first();
  return { userId, tenant: tenantId, user: { ...row, tenant: tenantId } };
}

type LineKind = 'bucket' | 'hourly';

/** A client with the given contract lines all covering `serviceId`, plus a ticket for it. */
async function seedClient(lines: LineKind[]) {
  const scoped = tenantDb(db, tenantId);
  const clientId = await createClient(db, tenantId, `Linkage client ${randomUUID().slice(0, 6)}`);
  const lineIds: string[] = [];
  const bucketIds: string[] = [];
  for (const kind of lines) {
    const contractId = randomUUID();
    const lineId = randomUUID();
    await scoped.table('contracts').insert({ tenant: tenantId, contract_id: contractId, contract_name: `Contract ${lineId.slice(0, 6)}` });
    await scoped.table('contract_lines').insert({
      tenant: tenantId,
      contract_line_id: lineId,
      contract_id: contractId,
      contract_line_name: `Line ${lineId.slice(0, 6)}`,
      contract_line_type: kind === 'bucket' ? 'Bucket' : 'Hourly',
      billing_frequency: 'monthly',
      cadence_owner: 'client',
      is_template: false,
      is_active: true,
    });
    await scoped.table('contract_line_services').insert({ tenant: tenantId, contract_line_id: lineId, service_id: serviceId, quantity: 1 });
    await scoped.table('client_contracts').insert({
      tenant: tenantId,
      client_contract_id: randomUUID(),
      client_id: clientId,
      contract_id: contractId,
      start_date: '2026-01-01',
      end_date: null,
      is_active: true,
    });
    if (kind === 'bucket') {
      const bucketId = randomUUID();
      await scoped.table('contract_line_buckets').insert({
        tenant: tenantId, bucket_id: bucketId, contract_line_id: lineId,
        total_minutes: 6000, overage_rate: 15000, allow_rollover: false, covers_all_services: false,
      });
      await scoped.table('contract_line_bucket_services').insert({
        tenant: tenantId, bucket_id: bucketId, contract_line_id: lineId, service_id: serviceId, burn_multiplier: 1,
      });
      bucketIds.push(bucketId);
    }
    lineIds.push(lineId);
  }
  const ticketId = randomUUID();
  await scoped.table('tickets').insert({
    tenant: tenantId, ticket_id: ticketId, ticket_number: `LNK-${randomUUID().slice(0, 6)}`,
    title: 'Linkage ticket', client_id: clientId,
  });
  return { clientId, ticketId, lineIds, bucketIds };
}

async function newUser(label: string, timezone = 'UTC') {
  const userId = await createStopwatchUser(db, tenantId, label, timezone);
  return { userId, ctx: await ctxFor(userId) };
}

/** Distinct days keep the (per-user) overlap check out of the way; the period covers all of Oct 2026. */
function body(ticketId: string, day: number, extra: Record<string, unknown> = {}) {
  const d = String(day).padStart(2, '0');
  return {
    work_item_id: ticketId,
    work_item_type: 'ticket' as const,
    service_id: serviceId,
    start_time: `2026-10-${d}T10:00:00.000Z`,
    end_time: `2026-10-${d}T11:00:00.000Z`,
    notes: 'linkage test',
    ...extra,
  };
}

const entryRow = (entryId: string) => tenantDb(db, tenantId).table('time_entries').where({ entry_id: entryId }).first();

/** `work_date` is a DATE column, so the driver may hand back a Date. */
const dateOnly = (value: unknown) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

async function bucketMinutes(clientId: string): Promise<number> {
  const rows = await tenantDb(db, tenantId).table('bucket_usage').where({ client_id: clientId }).select('minutes_used');
  return rows.reduce((sum: number, r: any) => sum + Number(r.minutes_used), 0);
}
const bucketRowCount = async (clientId: string) =>
  (await tenantDb(db, tenantId).table('bucket_usage').where({ client_id: clientId })).length;

async function expectValidation(promise: Promise<unknown>): Promise<ValidationError> {
  const error = await promise.then(() => null, (e) => e);
  expect(error).toBeInstanceOf(ValidationError);
  expect((error as ValidationError).statusCode).toBe(400);
  return error as ValidationError;
}

describe('TimeEntryService create/update contract-line linkage (real DB)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    wireLocalTestDbEnv();
    db = await createTestDbConnection({ databaseName: TEST_DB });
    // App-layer pools (BaseService/createTenantKnex) read DB_NAME_SERVER at call time.
    process.env.DB_NAME_SERVER = TEST_DB;
    tenantId = await createTenant(db, 'Time entry linkage tenant');
    const scoped = tenantDb(db, tenantId);
    await createPeriod(db, tenantId, '2026-09-01', '2026-12-01');
    serviceTypeId = randomUUID();
    await scoped.table('service_types').insert({ id: serviceTypeId, tenant: tenantId, name: `Linkage type ${serviceTypeId.slice(0, 6)}`, is_active: true });
    serviceId = randomUUID();
    await scoped.table('service_catalog').insert({
      tenant: tenantId, service_id: serviceId, service_name: `linkage-svc-${serviceId.slice(0, 6)}`,
      billing_method: 'hourly', custom_service_type_id: serviceTypeId,
    });
  }, 300_000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  it('(a) POST billable with one eligible bucket line links it, records provenance, and draws the bucket', async () => {
    const seed = await seedClient(['bucket']);
    const { ctx } = await newUser('a');
    const created = await asTenant(() => service.create(body(seed.ticketId, 1) as any, ctx));

    const row = await entryRow(created.entry_id);
    expect(row.contract_line_id).toBe(seed.lineIds[0]);
    expect(row.contract_line_source).toBe('auto_unique_service');
    expect(Number(row.billable_duration)).toBe(60);
    expect(await bucketMinutes(seed.clientId)).toBe(60);
  });

  it('(b) POST with two eligible lines and no choice is a 400 listing candidates, and leaves nothing behind', async () => {
    const seed = await seedClient(['bucket', 'bucket']);
    const { userId, ctx } = await newUser('b');
    const error = await expectValidation(asTenant(() => service.create(body(seed.ticketId, 2) as any, ctx)));

    expect(error.details.reason).toBe('contract_line_ambiguous');
    expect(error.details.eligible_contract_lines.map((l: any) => l.contract_line_id).sort()).toEqual([...seed.lineIds].sort());
    expect(error.details.eligible_contract_lines[0]).toEqual(expect.objectContaining({
      contract_line_name: expect.any(String), contract_line_type: 'Bucket', contract_name: expect.any(String),
    }));
    expect(await tenantDb(db, tenantId).table('time_entries').where({ user_id: userId })).toHaveLength(0);
    expect(await bucketRowCount(seed.clientId)).toBe(0);

    // The caller resends with a choice and it is used.
    const created = await asTenant(() => service.create(body(seed.ticketId, 2, { contract_line_id: seed.lineIds[1] }) as any, ctx));
    const row = await entryRow(created.entry_id);
    expect(row.contract_line_id).toBe(seed.lineIds[1]);
    expect(row.contract_line_source).toBe('explicit');
    expect(await bucketMinutes(seed.clientId)).toBe(60);
  });

  it('(c) POST with an ineligible explicit contract_line_id is a 400', async () => {
    const seed = await seedClient(['bucket']);
    const other = await seedClient(['hourly']);
    const { userId, ctx } = await newUser('c');
    for (const bogus of [randomUUID(), other.lineIds[0]]) {
      const error = await expectValidation(
        asTenant(() => service.create(body(seed.ticketId, 3, { contract_line_id: bogus }) as any, ctx)),
      );
      expect(error.details.reason).toBe('contract_line_not_eligible');
    }
    expect(await tenantDb(db, tenantId).table('time_entries').where({ user_id: userId })).toHaveLength(0);
    expect(await bucketRowCount(seed.clientId)).toBe(0);
  });

  it('(d) PATCH of notes only, then duration only, keeps the line and adjusts the bucket draw by the delta', async () => {
    const seed = await seedClient(['bucket']);
    const { ctx } = await newUser('d');
    const created = await asTenant(() => service.create(body(seed.ticketId, 4) as any, ctx));
    const id = created.entry_id;
    expect(await bucketMinutes(seed.clientId)).toBe(60);

    await asTenant(() => service.update(id, { notes: 'edited notes' } as any, ctx));
    let row = await entryRow(id);
    expect(row.notes).toBe('edited notes');
    expect(row.contract_line_id).toBe(seed.lineIds[0]);
    expect(row.contract_line_source).toBe('auto_unique_service');
    expect(await bucketMinutes(seed.clientId)).toBe(60); // reversed and re-applied, net unchanged

    await asTenant(() => service.update(id, { end_time: '2026-10-04T11:30:00.000Z' } as any, ctx));
    row = await entryRow(id);
    expect(Number(row.billable_duration)).toBe(90);
    expect(row.contract_line_id).toBe(seed.lineIds[0]);
    expect(row.contract_line_source).toBe('auto_unique_service');
    expect(await bucketMinutes(seed.clientId)).toBe(90); // 60 reversed, 90 applied

    await asTenant(() => service.update(id, { end_time: '2026-10-04T10:45:00.000Z' } as any, ctx));
    expect(await bucketMinutes(seed.clientId)).toBe(45);
    expect((await entryRow(id)).contract_line_id).toBe(seed.lineIds[0]);
  });

  it('(e) PATCH to non-billable clears the line and reverses the bucket draw', async () => {
    const seed = await seedClient(['bucket']);
    const { ctx } = await newUser('e');
    const created = await asTenant(() => service.create(body(seed.ticketId, 5) as any, ctx));
    expect(await bucketMinutes(seed.clientId)).toBe(60);

    await asTenant(() => service.update(created.entry_id, { is_billable: false } as any, ctx));
    const row = await entryRow(created.entry_id);
    expect(Number(row.billable_duration)).toBe(0);
    expect(row.contract_line_id).toBeNull();
    expect(row.contract_line_source).toBeNull();
    expect(await bucketMinutes(seed.clientId)).toBe(0);
  });

  it('(f) POST with no eligible line saves the entry as unresolved, with no draw', async () => {
    const seed = await seedClient([]);
    const { ctx } = await newUser('f');
    const created = await asTenant(() => service.create(body(seed.ticketId, 6) as any, ctx));
    const row = await entryRow(created.entry_id);
    expect(row).toBeTruthy();
    expect(row.contract_line_id).toBeNull();
    expect(row.contract_line_source).toBe('unresolved');
    expect(await bucketRowCount(seed.clientId)).toBe(0);
  });

  it('non-billable POST carries no linkage and no draw', async () => {
    const seed = await seedClient(['bucket']);
    const { ctx } = await newUser('nb');
    const created = await asTenant(() => service.create(body(seed.ticketId, 7, { is_billable: false }) as any, ctx));
    const row = await entryRow(created.entry_id);
    expect(row.contract_line_id).toBeNull();
    expect(Number(row.billable_duration)).toBe(0);
    expect(await bucketRowCount(seed.clientId)).toBe(0);
  });

  it('(g) DELETE reverses the bucket draw back to its prior value (G1)', async () => {
    const seed = await seedClient(['bucket']);
    const { ctx } = await newUser('g');
    const first = await asTenant(() => service.create(body(seed.ticketId, 8) as any, ctx));
    const before = await bucketMinutes(seed.clientId);
    expect(before).toBe(60);

    const second = await asTenant(() => service.create(body(seed.ticketId, 9) as any, ctx));
    expect(await bucketMinutes(seed.clientId)).toBe(before + 60);

    await asTenant(() => service.delete(second.entry_id, ctx));
    expect(await entryRow(second.entry_id)).toBeFalsy();
    expect(await bucketMinutes(seed.clientId)).toBe(before);
    expect(await entryRow(first.entry_id)).toBeTruthy();
  });

  it('(h) bulk DELETE reverses the bucket draw for every entry', async () => {
    const seed = await seedClient(['bucket']);
    const { ctx } = await newUser('h');
    const a = await asTenant(() => service.create(body(seed.ticketId, 10) as any, ctx));
    const b = await asTenant(() => service.create(body(seed.ticketId, 11) as any, ctx));
    expect(await bucketMinutes(seed.clientId)).toBe(120);

    const results = await asTenant(() =>
      service.bulkDeleteTimeEntries({ entry_ids: [a.entry_id, b.entry_id] } as any, ctx));
    expect(results.every((r: any) => r.success)).toBe(true);
    expect(await bucketMinutes(seed.clientId)).toBe(0);
  });

  it('(i) POST running past local midnight stays on the sheet its work_date buckets to', async () => {
    // 2026-12-01T07:30Z is 2026-11-30 23:30 in Los Angeles: work_date is the
    // period's last day while the end work date is already in the next period.
    // The REST sheet is picked from work_date, so there is no other sheet the
    // caller could name and this has to save rather than 400.
    const seed = await seedClient(['bucket']);
    const { ctx } = await newUser('i', 'America/Los_Angeles');
    const created = await asTenant(() => service.create({
      work_item_id: seed.ticketId,
      work_item_type: 'ticket',
      service_id: serviceId,
      start_time: '2026-12-01T07:30:00.000Z',
      end_time: '2026-12-01T08:30:00.000Z',
      notes: 'crosses local midnight',
    } as any, ctx));

    const row = await entryRow(created.entry_id);
    expect(dateOnly(row.work_date)).toBe('2026-11-30');
    expect(row.work_timezone).toBe('America/Los_Angeles');
    expect(row.contract_line_id).toBe(seed.lineIds[0]);
    expect(await bucketMinutes(seed.clientId)).toBe(60);
  });
});
