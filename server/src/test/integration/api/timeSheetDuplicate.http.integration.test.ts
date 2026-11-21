import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

import { BaseService, tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

/**
 * HTTP-level regression for duplicate time sheets: the real POST route handler, controller,
 * service, database and error middleware run. Only identity (API key lookup, RBAC grant, rate
 * limit, product gate) and the known-broken creation publisher are stubbed.
 */

const identity = vi.hoisted(() => ({ tenant: '', usersByKey: new Map<string, string>() }));

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: vi.fn(async (key: string) => {
      const userId = identity.usersByKey.get(key);
      return userId ? { user_id: userId, tenant: identity.tenant, api_key_id: uuidv4() } : null;
    }),
    validateApiKeyForTenant: vi.fn(async (key: string) => {
      const userId = identity.usersByKey.get(key);
      return userId ? { user_id: userId, tenant: identity.tenant, api_key_id: uuidv4() } : null;
    }),
  },
}));
vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: vi.fn(async (userId: string, tenant: string) => ({ user_id: userId, tenant, user_type: 'internal', roles: [] })),
}));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@/lib/api/rateLimit/enforce', () => ({ enforceApiRateLimit: async () => null }));
vi.mock('@/lib/productAccess', () => ({ getTenantProduct: async () => 'psa' }));

let db: Knex;
vi.mock('@/lib/db/db', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getConnection: async () => db,
}));

import { POST } from '@/app/api/v1/time-sheets/route';

const tenantTable = (tenant: string, table: string) => tenantDb(db, tenant).table(table);
const tenantRows = () =>
  tenantDb(db, '__test_tenant_fixture__').unscoped('tenants', 'test fixture creates and removes tenant rows');

const CONFLICT_BODY = { error: { code: 'CONFLICT', message: 'A time sheet already exists for this user and period' } };

let tenant: string;
let userId: string;
let periodId: string;
const tenantsToCleanup = new Set<string>();

function post(body: unknown, key = 'key-user') {
  return POST(new NextRequest('http://localhost/api/v1/time-sheets', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify(body),
  }) as any);
}

describe('POST /api/v1/time-sheets duplicate blocking (route -> controller -> service -> middleware)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    vi.spyOn(BaseService.prototype as any, 'getKnex').mockImplementation(async () => ({ knex: db, tenant }));
  }, 180_000);

  beforeEach(async () => {
    tenant = uuidv4();
    identity.tenant = tenant;
    tenantsToCleanup.add(tenant);
    await tenantRows().insert({ tenant, client_name: `HTTP TS ${tenant.slice(0, 8)}`, email: `h-${tenant.slice(0, 8)}@example.com` });
    userId = uuidv4();
    await tenantTable(tenant, 'users').insert({
      tenant, user_id: userId, username: `h-${userId.slice(0, 8)}`, hashed_password: 'x', user_type: 'internal',
      email: `h-${userId.slice(0, 8)}@example.com`, first_name: 'Http', last_name: 'Tester',
    });
    identity.usersByKey = new Map([['key-user', userId]]);
    periodId = uuidv4();
    await tenantTable(tenant, 'time_periods').insert({ period_id: periodId, tenant, start_date: '2026-02-02', end_date: '2026-02-09' });
  });

  afterEach(async () => {
    for (const id of tenantsToCleanup) {
      await tenantTable(id, 'time_sheets').del();
      await tenantTable(id, 'time_periods').del();
      await tenantTable(id, 'users').del();
      await tenantRows().where({ tenant: id }).del();
    }
    tenantsToCleanup.clear();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await db?.destroy();
  });

  it('first POST is 201; a repeat is 409 with the exact body; the sheet is untouched', async () => {
    const first = await post({ period_id: periodId });
    expect(first.status).toBe(201);
    const created = (await first.json()).data;
    expect(created).toMatchObject({ user_id: userId, period_id: periodId, approval_status: 'DRAFT' });

    const second = await post({ period_id: periodId });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual(CONFLICT_BODY);

    const rows = await tenantTable(tenant, 'time_sheets').where({ user_id: userId, period_id: periodId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: created.id, approval_status: 'DRAFT' });
  });

  it('omitted and explicit self user_id are the same logical owner, in either order', async () => {
    expect((await post({ period_id: periodId })).status).toBe(201);
    const explicit = await post({ period_id: periodId, user_id: userId });
    expect(explicit.status).toBe(409);
    expect(await explicit.json()).toEqual(CONFLICT_BODY);

    const otherPeriod = uuidv4();
    await tenantTable(tenant, 'time_periods').insert({ period_id: otherPeriod, tenant, start_date: '2026-02-09', end_date: '2026-02-16' });
    expect((await post({ period_id: otherPeriod, user_id: userId })).status).toBe(201);
    const omitted = await post({ period_id: otherPeriod });
    expect(omitted.status).toBe(409);
    expect(await omitted.json()).toEqual(CONFLICT_BODY);

    expect(await tenantTable(tenant, 'time_sheets').where({ user_id: userId })).toHaveLength(2);
  });

  it('a non-DRAFT sheet still yields 409 and keeps its status and id', async () => {
    const existingId = uuidv4();
    await tenantTable(tenant, 'time_sheets').insert({ tenant, id: existingId, user_id: userId, period_id: periodId, approval_status: 'APPROVED' });
    const response = await post({ period_id: periodId });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(CONFLICT_BODY);
    const rows = await tenantTable(tenant, 'time_sheets').where({ user_id: userId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: existingId, approval_status: 'APPROVED' });
  });
});
