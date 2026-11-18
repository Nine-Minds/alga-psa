import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

// Failure case C3 (alga-2026-0002797): a date-only end_date must cover the whole
// UTC day on BOTH GET /api/v1/schedules and GET /api/v1/schedules/search.
// The real route handlers, controller, query schemas and TimeSheetService run
// against Postgres; only API-key auth and RBAC are stubbed.

vi.mock('next/server', async () => ({
  ...await import('next/dist/server/web/spec-extension/request'),
  ...await import('next/dist/server/web/spec-extension/response'),
}));

const mocks = vi.hoisted(() => ({
  tenantId: '',
  userId: '',
}));

vi.mock('../../../lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: vi.fn(async () => ({ user_id: mocks.userId, tenant: mocks.tenantId, api_key_id: 'k1' })),
    validateApiKeyForTenant: vi.fn(async () => ({ user_id: mocks.userId, tenant: mocks.tenantId, api_key_id: 'k1' })),
  },
}));
vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: vi.fn(async () => ({ user_id: mocks.userId, tenant: mocks.tenantId, user_type: 'internal' })),
}));
vi.mock('../../../lib/db', () => ({ runWithTenant: (_t: string, fn: () => any) => fn() }));
vi.mock('../../../lib/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

const HOOK_TIMEOUT = 180_000;

let db: Knex;
let listRoute: (req: Request) => Promise<Response>;
let searchRoute: (req: Request) => Promise<Response>;

// Fixture entries (UTC), named by what they probe around 2026-11-04.
const ENTRIES = {
  spansIntoDay: ['2026-11-03T23:00:00Z', '2026-11-04T01:00:00Z'],
  afternoon: ['2026-11-04T15:00:00Z', '2026-11-04T16:00:00Z'], // C3
  lastSecond: ['2026-11-04T23:00:00Z', '2026-11-04T23:59:59.500Z'],
  spansPastDay: ['2026-11-04T23:30:00Z', '2026-11-05T00:30:00Z'],
  nextDay: ['2026-11-05T00:00:00Z', '2026-11-05T01:00:00Z'],
} as const;
type EntryName = keyof typeof ENTRIES;
const entryIds = {} as Record<EntryName, string>;

function table(name: string) {
  return tenantDb(db, mocks.tenantId).table(name);
}

function tenantRows() {
  return tenantDb(db, '__schedules_date_bounds_fixture__')
    .unscoped('tenants', 'schedules date-bounds fixture creates and removes its tenant row');
}

async function get(route: typeof listRoute, path: string, qs: string): Promise<{ status: number; body: any }> {
  const res = await route(new Request(`http://localhost/api/v1/${path}?${qs}`, { headers: { 'x-api-key': 'k' } }));
  return { status: res.status, body: await res.json() };
}

function names(rows: Array<{ entry_id: string }>): EntryName[] {
  const byId = new Map(Object.entries(entryIds).map(([name, id]) => [id, name as EntryName]));
  return rows.map((row) => byId.get(row.entry_id)).filter((n): n is EntryName => !!n).sort();
}

beforeAll(async () => {
  db = await createTestDbConnection();

  const { TimeSheetService } = await import('../../../lib/api/services/TimeSheetService');
  vi.spyOn(TimeSheetService.prototype as any, 'getKnex').mockImplementation(async () => ({ knex: db, tenant: mocks.tenantId }));
  const { ApiTimeSheetController } = await import('../../../lib/api/controllers/ApiTimeSheetController');
  vi.spyOn(ApiTimeSheetController.prototype as any, 'assertProductApiAccess').mockResolvedValue(undefined);

  listRoute = (await import('../../../app/api/v1/schedules/route')).GET as any;
  searchRoute = (await import('../../../app/api/v1/schedules/search/route')).GET as any;

  mocks.tenantId = uuidv4();
  mocks.userId = uuidv4();
  await tenantRows().insert({
    tenant: mocks.tenantId,
    client_name: `Schedules C3 ${mocks.tenantId.slice(0, 8)}`,
    email: `c3-${mocks.tenantId.slice(0, 8)}@example.com`,
  });
  await table('users').insert({
    tenant: mocks.tenantId,
    user_id: mocks.userId,
    username: `c3-${mocks.userId.slice(0, 8)}`,
    hashed_password: 'x',
    email: `c3-${mocks.userId.slice(0, 8)}@example.com`,
  });
  for (const [name, [start, end]] of Object.entries(ENTRIES) as Array<[EntryName, readonly [string, string]]>) {
    const entryId = uuidv4();
    entryIds[name] = entryId;
    await table('schedule_entries').insert({
      tenant: mocks.tenantId,
      entry_id: entryId,
      title: name,
      status: 'scheduled',
      work_item_type: 'ad_hoc',
      scheduled_start: start,
      scheduled_end: end,
    });
    await table('schedule_entry_assignees').insert({ tenant: mocks.tenantId, entry_id: entryId, user_id: mocks.userId });
  }
}, HOOK_TIMEOUT);

afterAll(async () => {
  if (db && mocks.tenantId) {
    await table('schedule_entry_assignees').del();
    await table('schedule_entries').del();
    await table('users').del();
    await tenantRows().where({ tenant: mocks.tenantId }).del();
  }
  await db?.destroy();
}, HOOK_TIMEOUT);

describe('schedule entry date bounds (GET /api/v1/schedules and /schedules/search)', () => {
  beforeEach(() => {
    expect(mocks.tenantId).not.toBe('');
  });

  it.each<[string, EntryName[]]>([
    // C3: date-only end_date runs through the end of the UTC day.
    ['end_date=2026-11-04', ['afternoon', 'lastSecond', 'spansIntoDay']],
    // Date-only start_date means 00:00Z that day; together they name the whole day.
    ['start_date=2026-11-04&end_date=2026-11-04', ['afternoon', 'lastSecond']],
    // Explicit date-times keep their exact, inclusive meaning.
    ['start_date=2026-11-04&end_date=2026-11-04T23:59:59Z', ['afternoon']],
    ['start_date=2026-11-04&end_date=2026-11-04T15:30:00Z', []],
    ['start_date=2026-11-04T00:00:00Z&end_date=2026-11-04T16:00:00Z', ['afternoon']],
    ['start_date=2026-11-04T23:30:00Z', ['nextDay', 'spansPastDay']],
  ])('%s returns the same entries from both endpoints', async (qs, expected) => {
    const list = await get(listRoute, 'schedules', qs);
    const search = await get(searchRoute, 'schedules/search', `${qs}&limit=100`);

    expect(list.status).toBe(200);
    expect(search.status).toBe(200);
    expect(names(list.body.data)).toEqual([...expected].sort());
    expect(names(search.body.data)).toEqual([...expected].sort());
    expect(search.body.pagination.total).toBe(expected.length);
  });
});
