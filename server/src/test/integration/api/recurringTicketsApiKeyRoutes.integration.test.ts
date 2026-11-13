/* @vitest-environment node */

/**
 * /api/v1/tickets/recurring through the real route modules, the real ApiRecurringTicketController,
 * the real withAuth-wrapped recurring-ticket actions and a real migrated database. Only the edges are
 * stubbed: API-key lookup (key -> tenant + user), the RBAC grant table, rate limiting and the product
 * gate. Two tenants are seeded so the isolation tests can aim one tenant's key at the other's records.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../../test-utils/testDataFactory';

let testDb: Knex;

/** API key -> { tenant, user, granted `resource:action`s }. */
const keys = vi.hoisted(() => new Map<string, { tenant: string; userId: string; grants: Set<string> }>());
const grantsFor = (userId: string) => [...keys.values()].find((key) => key.userId === userId)?.grants ?? new Set<string>();

const sessionAuth = vi.hoisted(() => ({ resolve: vi.fn(async () => null) }));

// The production withAuth + API-key AsyncLocalStorage resolve the caller, not the permissive test facade.
vi.unmock('@alga-psa/auth');
vi.mock('../../../../../packages/auth/src/lib/getSession', () => ({
  getSession: sessionAuth.resolve,
  getSessionWithRevocationCheck: sessionAuth.resolve,
  logSessionRejection: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  hasPermission: vi.fn(async (user: { user_id: string }, resource: string, action: string) =>
    grantsFor(user.user_id).has(`${resource}:${action}`)),
}));
vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async (user: { user_id: string }, resource: string, action: string) =>
    grantsFor(user.user_id).has(`${resource}:${action}`)),
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: async () => ({ knex: testDb, tenant: actual.getTenantContext() }),
  };
});
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => testDb) }));

vi.mock('@/lib/services/apiKeyServiceForApi', () => {
  const lookup = async (key: string) => {
    const entry = keys.get(key);
    return entry ? { user_id: entry.userId, tenant: entry.tenant, api_key_id: `key-${key}` } : null;
  };
  return {
    ApiKeyServiceForApi: {
      validateApiKeyAnyTenant: vi.fn(lookup),
      validateApiKeyForTenant: vi.fn(async (key: string, tenant: string) => {
        const record = await lookup(key);
        return record && record.tenant === tenant ? record : null;
      }),
    },
  };
});
vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: vi.fn(async (userId: string, tenant: string) => ({
    user_id: userId, tenant, user_type: 'internal', roles: [],
  })),
}));
vi.mock('@/lib/api/rateLimit/enforce', () => ({ enforceApiRateLimit: async () => null }));
vi.mock('@/lib/productAccess', () => ({
  getTenantProduct: async () => 'psa',
  ProductAccessError: class extends Error {},
}));

import * as collectionRoute from '@/app/api/v1/tickets/recurring/route';
import * as previewRoute from '@/app/api/v1/tickets/recurring/preview/route';
import * as definitionRoute from '@/app/api/v1/tickets/recurring/[definitionId]/route';
import * as pauseRoute from '@/app/api/v1/tickets/recurring/[definitionId]/pause/route';
import * as resumeRoute from '@/app/api/v1/tickets/recurring/[definitionId]/resume/route';
import * as upcomingRoute from '@/app/api/v1/tickets/recurring/[definitionId]/upcoming/route';
import * as occurrencesRoute from '@/app/api/v1/tickets/recurring/[definitionId]/occurrences/route';
import * as clientsRoute from '@/app/api/v1/tickets/recurring/[definitionId]/clients/route';
import * as clientRoute from '@/app/api/v1/tickets/recurring/[definitionId]/clients/[clientId]/route';
import * as clientPauseRoute from '@/app/api/v1/tickets/recurring/[definitionId]/clients/[clientId]/pause/route';
import * as clientResumeRoute from '@/app/api/v1/tickets/recurring/[definitionId]/clients/[clientId]/resume/route';

const ALL_RECURRING = ['read', 'create', 'update', 'delete'].map((action) => `recurring_ticket:${action}`);
const FULL = new Set([...ALL_RECURRING, 'ticket_template:read']);
const READ_ONLY = new Set(['recurring_ticket:read', 'ticket_template:read']);

interface TenantFixture {
  tenant: string;
  userId: string;
  clientId: string;
  otherClientId: string;
  templateId: string;
  key: string;
  readKey: string;
}

async function seedTenant(label: string): Promise<TenantFixture> {
  const tenant = await createTenant(testDb, `Recurring API ${label} ${uuidv4().slice(0, 6)}`);
  const clientId = await createClient(testDb, tenant, `${label} Joymode`);
  const otherClientId = await createClient(testDb, tenant, `${label} Globex`);
  const userId = await createUser(testDb, tenant);
  const readerId = await createUser(testDb, tenant);
  const scoped = tenantDb(testDb, tenant);
  const boardId = uuidv4();
  await scoped.table('boards').insert({ tenant, board_id: boardId, board_name: 'Maintenance', is_default: true });
  await scoped.table('statuses').insert({
    tenant, status_id: uuidv4(), board_id: boardId, name: 'New', status_type: 'ticket', item_type: 'ticket',
    order_number: 1, is_default: true, is_closed: false,
  });
  const priorityId = uuidv4();
  await scoped.table('priorities').insert({
    tenant, priority_id: priorityId, priority_name: 'Medium', item_type: 'ticket', order_number: 1, color: '#ccc', created_by: userId,
  });
  await scoped.table('tenant_settings')
    .insert({ tenant, settings: JSON.stringify({ timezone: 'America/New_York' }) })
    .onConflict('tenant').merge();
  const templateId = uuidv4();
  await scoped.table('ticket_templates').insert({
    tenant, template_id: templateId, name: 'APNs renewal', title: 'Renew Apple APNs certificate for {{client}}',
    board_id: boardId, priority_id: priorityId, category_id: null, tags: JSON.stringify([]), offer_for_manual_use: false,
  });
  const key = `key-${label}-${uuidv4()}`;
  const readKey = `read-${label}-${uuidv4()}`;
  keys.set(key, { tenant, userId, grants: FULL });
  keys.set(readKey, { tenant, userId: readerId, grants: READ_ONLY });
  return { tenant, userId, clientId, otherClientId, templateId, key, readKey };
}

type RouteHandler = (req: any, ctx?: any) => Promise<Response>;

async function call(handler: RouteHandler, method: string, path: string, key: string, body?: unknown) {
  const request = new NextRequest(`http://localhost/api/v1/tickets/recurring${path}`, {
    method,
    headers: { 'x-api-key': key, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handler(request);
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

const apnsDefinition = (f: TenantFixture, overrides: Record<string, unknown> = {}) => ({
  name: 'Apple APNs certificate renewal',
  ticket_template_id: f.templateId,
  recurrence: { frequency: 'yearly', month: 3, day: 1, end: { type: 'never' } },
  start_date: '2027-03-01',
  lead_days: 30,
  non_business_day_policy: 'previous',
  ...overrides,
});

async function createApns(f: TenantFixture): Promise<string> {
  const created = await call(collectionRoute.POST, 'POST', '', f.key, apnsDefinition(f));
  expect(created.status).toBe(201);
  return created.json.data.definition.definition_id as string;
}

describe('/api/v1/tickets/recurring route handlers (API key, real database)', () => {
  let a: TenantFixture;
  let b: TenantFixture;

  beforeAll(async () => {
    testDb = await createTestDbConnection();
  }, 900_000);

  afterAll(async () => {
    await testDb?.destroy();
  });

  beforeEach(async () => {
    keys.clear();
    a = await seedTenant('A');
    b = await seedTenant('B');
  }, 60_000);

  it('runs the done-when path: create, add client, upcoming, pause, resume, history', async () => {
    const created = await call(collectionRoute.POST, 'POST', '', a.key, apnsDefinition(a));
    expect(created.status).toBe(201);
    expect(sessionAuth.resolve).not.toHaveBeenCalled();
    const definitionId = created.json.data.definition.definition_id;
    expect(created.json.data.definition).toMatchObject({
      name: 'Apple APNs certificate renewal', lead_days: 30, non_business_day_policy: 'previous', is_active: true,
    });
    expect(created.json.data.clients).toEqual([]);

    const added = await call(clientsRoute.POST, 'POST', `/${definitionId}/clients`, a.key, { client_ids: [a.clientId] });
    expect(added.status).toBe(200);
    expect(added.json.data.added).toBe(1);
    expect(added.json.data.clients.map((c: any) => c.client_id)).toEqual([a.clientId]);

    const upcoming = await call(upcomingRoute.GET, 'GET', `/${definitionId}/upcoming`, a.key);
    expect(upcoming.status).toBe(200);
    expect(upcoming.json.data.definition_status).toBe('active');
    expect(upcoming.json.data.time_zone).toBe('America/New_York');
    // The engine searches at most 1500 days ahead, so a yearly rule yields fewer than the 5 a monthly one does.
    const years = upcoming.json.data.occurrences.map((o: any) => Number(String(o.nominal).slice(0, 4)));
    expect(years.length).toBeGreaterThanOrEqual(3);
    expect(years).toEqual(years.map((_: number, i: number) => 2027 + i));
    for (const o of upcoming.json.data.occurrences) expect(String(o.nominal).slice(5)).toBe('03-01');

    const paused = await call(pauseRoute.POST, 'POST', `/${definitionId}/pause`, a.key);
    expect(paused.status).toBe(200);
    expect(paused.json.data.definition.is_active).toBe(false);
    const pausedList = await call(collectionRoute.GET, 'GET', '?status=paused', a.key);
    expect(pausedList.json.data.map((d: any) => d.definition_id)).toEqual([definitionId]);

    const resumed = await call(resumeRoute.POST, 'POST', `/${definitionId}/resume`, a.key);
    expect(resumed.status).toBe(200);
    expect(resumed.json.data.definition.is_active).toBe(true);

    // History: the generator writes occurrence rows; seed one as it would and read it back through the API.
    const [row] = await tenantDb(testDb, a.tenant).table('recurring_ticket_definition_clients').where({ definition_id: definitionId });
    await tenantDb(testDb, a.tenant).table('recurring_ticket_occurrences').insert({
      tenant: a.tenant, occurrence_id: uuidv4(), definition_id: definitionId, definition_client_id: row.definition_client_id,
      client_id: a.clientId, occurrence_date: '2027-03-01', due_date: '2027-03-01', status: 'skipped', reason: 'test', attempts: 1,
    });
    const history = await call(occurrencesRoute.GET, 'GET', `/${definitionId}/occurrences?limit=10`, a.key);
    expect(history.status).toBe(200);
    expect(history.json.data).toHaveLength(1);
    expect(history.json.data[0]).toMatchObject({ status: 'skipped', occurrence_date: '2027-03-01' });
    expect(history.json.pagination).toMatchObject({ page: 1, limit: 10, total: 1 });
  });

  it('lists, searches and reads definitions; PUT replaces the whole definition', async () => {
    const definitionId = await createApns(a);
    await call(collectionRoute.POST, 'POST', '', a.key, apnsDefinition(a, { name: 'Domain renewal' }));

    const searched = await call(collectionRoute.GET, 'GET', '?search=apns', a.key);
    expect(searched.status).toBe(200);
    expect(searched.json.data.map((d: any) => d.definition_id)).toEqual([definitionId]);
    expect(searched.json.pagination.total).toBe(1);

    const got = await call(definitionRoute.GET, 'GET', `/${definitionId}`, a.key);
    expect(got.status).toBe(200);
    expect(got.json.data.definition.lead_days).toBe(30);

    const replaced = await call(definitionRoute.PUT, 'PUT', `/${definitionId}`, a.key, {
      name: 'APNs renewal (replaced)',
      ticket_template_id: a.templateId,
      recurrence: { frequency: 'yearly', month: 4, day: 15, end: { type: 'never' } },
      start_date: '2027-04-15',
    });
    expect(replaced.status).toBe(200);
    expect(replaced.json.data.definition).toMatchObject({
      name: 'APNs renewal (replaced)', lead_days: 0, non_business_day_policy: 'keep',
    });
  });

  it('previews an unsaved schedule without writing anything', async () => {
    const before = await tenantDb(testDb, a.tenant).table('recurring_ticket_definitions').count('* as n').first();
    const preview = await call(previewRoute.POST, 'POST', '/preview', a.key, {
      ticket_template_id: a.templateId,
      recurrence: { frequency: 'monthly', interval: 1, on: { type: 'dayOfMonth', day: 1 }, end: { type: 'never' } },
      start_date: '2027-01-04',
      create_time: '08:00',
      due_time: '17:00',
      lead_days: 30,
      non_business_day_policy: 'previous',
    });
    expect(preview.status).toBe(200);
    expect(preview.json.data.occurrences).toHaveLength(5);
    const after = await tenantDb(testDb, a.tenant).table('recurring_ticket_definitions').count('* as n').first();
    expect(Number(after?.n)).toBe(Number(before?.n));
  });

  it('manages one client on the definition: overrides, pause, resume, remove (history kept)', async () => {
    const definitionId = await createApns(a);
    await call(clientsRoute.POST, 'POST', `/${definitionId}/clients`, a.key, { client_ids: [a.clientId, a.otherClientId] });

    const updated = await call(clientRoute.PUT, 'PUT', `/${definitionId}/clients/${a.clientId}`, a.key, {
      overrides: {}, contact_id: null, location_id: null, asset_ids: [],
    });
    expect(updated.status).toBe(200);

    const pausedClient = await call(clientPauseRoute.POST, 'POST', `/${definitionId}/clients/${a.clientId}/pause`, a.key);
    expect(pausedClient.status).toBe(200);
    expect(pausedClient.json.data.clients.find((c: any) => c.client_id === a.clientId).is_active).toBe(false);
    expect(pausedClient.json.data.clients.find((c: any) => c.client_id === a.otherClientId).is_active).toBe(true);

    const resumedClient = await call(clientResumeRoute.POST, 'POST', `/${definitionId}/clients/${a.clientId}/resume`, a.key);
    expect(resumedClient.json.data.clients.find((c: any) => c.client_id === a.clientId).is_active).toBe(true);

    const removed = await call(clientRoute.DELETE, 'DELETE', `/${definitionId}/clients/${a.clientId}`, a.key);
    expect(removed.status).toBe(204);
    const got = await call(definitionRoute.GET, 'GET', `/${definitionId}`, a.key);
    expect(got.json.data.clients.map((c: any) => c.client_id)).toEqual([a.otherClientId]);

    const again = await call(clientRoute.DELETE, 'DELETE', `/${definitionId}/clients/${a.clientId}`, a.key);
    expect(again.status).toBe(404);
  });

  it('a client on a different definition is a 404, and the other definition is untouched', async () => {
    const first = await createApns(a);
    const second = await createApns(a);
    await call(clientsRoute.POST, 'POST', `/${second}/clients`, a.key, { client_ids: [a.clientId] });

    const wrongParent = await call(clientPauseRoute.POST, 'POST', `/${first}/clients/${a.clientId}/pause`, a.key);
    expect(wrongParent.status).toBe(404);
    const [row] = await tenantDb(testDb, a.tenant).table('recurring_ticket_definition_clients').where({ definition_id: second });
    expect(row.is_active).toBe(true);
  });

  it('DELETE archives: the definition stays readable, later writes are 409', async () => {
    const definitionId = await createApns(a);
    const deleted = await call(definitionRoute.DELETE, 'DELETE', `/${definitionId}`, a.key);
    expect(deleted.status).toBe(204);

    const got = await call(definitionRoute.GET, 'GET', `/${definitionId}`, a.key);
    expect(got.status).toBe(200);
    expect(got.json.data.definition.archived_at).toBeTruthy();
    const archived = await call(collectionRoute.GET, 'GET', '?status=archived', a.key);
    expect(archived.json.data.map((d: any) => d.definition_id)).toEqual([definitionId]);

    expect((await call(pauseRoute.POST, 'POST', `/${definitionId}/pause`, a.key)).status).toBe(409);
    expect((await call(definitionRoute.PUT, 'PUT', `/${definitionId}`, a.key, apnsDefinition(a))).status).toBe(409);
    expect((await call(clientsRoute.POST, 'POST', `/${definitionId}/clients`, a.key, { client_ids: [a.clientId] })).status).toBe(409);
  });

  it('rejects bad input: unknown body keys, a missing template, a client from nowhere', async () => {
    const withTitle = await call(collectionRoute.POST, 'POST', '', a.key, { ...apnsDefinition(a), title: 'not here' });
    expect(withTitle.status).toBe(400);

    const badTemplate = await call(collectionRoute.POST, 'POST', '', a.key, apnsDefinition(a, { ticket_template_id: uuidv4() }));
    expect(badTemplate.status).toBe(400);

    const definitionId = await createApns(a);
    const ghost = await call(clientsRoute.POST, 'POST', `/${definitionId}/clients`, a.key, { client_ids: [uuidv4()] });
    expect(ghost.status).toBe(400);

    expect((await call(definitionRoute.GET, 'GET', '/not-a-uuid', a.key)).status).toBe(400);
    expect((await call(definitionRoute.GET, 'GET', `/${uuidv4()}`, a.key)).status).toBe(404);
  });

  it('RBAC: a read-only key reads but every write is 403 and nothing changes', async () => {
    const definitionId = await createApns(a);
    await call(clientsRoute.POST, 'POST', `/${definitionId}/clients`, a.key, { client_ids: [a.clientId] });

    expect((await call(collectionRoute.GET, 'GET', '', a.readKey)).status).toBe(200);
    expect((await call(definitionRoute.GET, 'GET', `/${definitionId}`, a.readKey)).status).toBe(200);
    expect((await call(upcomingRoute.GET, 'GET', `/${definitionId}/upcoming`, a.readKey)).status).toBe(200);
    expect((await call(occurrencesRoute.GET, 'GET', `/${definitionId}/occurrences`, a.readKey)).status).toBe(200);

    const writes: Array<[RouteHandler, string, string, unknown?]> = [
      [collectionRoute.POST, 'POST', '', apnsDefinition(a)],
      [definitionRoute.PUT, 'PUT', `/${definitionId}`, apnsDefinition(a, { name: 'hijacked' })],
      [definitionRoute.DELETE, 'DELETE', `/${definitionId}`],
      [pauseRoute.POST, 'POST', `/${definitionId}/pause`],
      [resumeRoute.POST, 'POST', `/${definitionId}/resume`],
      [clientsRoute.POST, 'POST', `/${definitionId}/clients`, { client_ids: [a.otherClientId] }],
      [clientRoute.PUT, 'PUT', `/${definitionId}/clients/${a.clientId}`, { overrides: {}, contact_id: null, location_id: null, asset_ids: [] }],
      [clientPauseRoute.POST, 'POST', `/${definitionId}/clients/${a.clientId}/pause`],
      [clientResumeRoute.POST, 'POST', `/${definitionId}/clients/${a.clientId}/resume`],
      [clientRoute.DELETE, 'DELETE', `/${definitionId}/clients/${a.clientId}`],
    ];
    for (const [handler, method, path, body] of writes) {
      const response = await call(handler, method, path, a.readKey, body);
      expect(response.status, `${method} ${path}`).toBe(403);
    }

    const definitions = await tenantDb(testDb, a.tenant).table('recurring_ticket_definitions').select('*');
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({ name: 'Apple APNs certificate renewal', is_active: true, archived_at: null });
    const clients = await tenantDb(testDb, a.tenant).table('recurring_ticket_definition_clients').where({ definition_id: definitionId });
    expect(clients.map((c: any) => [c.client_id, c.is_active])).toEqual([[a.clientId, true]]);
  });

  it('create without ticket_template:read is refused by the action, not just the controller', async () => {
    const noTemplateRead = `no-template-${uuidv4()}`;
    const userId = await createUser(testDb, a.tenant);
    keys.set(noTemplateRead, { tenant: a.tenant, userId, grants: new Set(ALL_RECURRING) });
    const refused = await call(collectionRoute.POST, 'POST', '', noTemplateRead, apnsDefinition(a));
    expect(refused.status).toBe(403);
    const count = await tenantDb(testDb, a.tenant).table('recurring_ticket_definitions').count('* as n').first();
    expect(Number(count?.n)).toBe(0);
  });

  it('tenant isolation: tenant B cannot list, read, write or manage clients on tenant A records', async () => {
    const definitionId = await createApns(a);
    await call(clientsRoute.POST, 'POST', `/${definitionId}/clients`, a.key, { client_ids: [a.clientId] });
    const [row] = await tenantDb(testDb, a.tenant).table('recurring_ticket_definition_clients').where({ definition_id: definitionId });
    await tenantDb(testDb, a.tenant).table('recurring_ticket_occurrences').insert({
      tenant: a.tenant, occurrence_id: uuidv4(), definition_id: definitionId, definition_client_id: row.definition_client_id,
      client_id: a.clientId, occurrence_date: '2027-03-01', due_date: '2027-03-01', status: 'skipped', reason: 'test', attempts: 1,
    });

    const listed = await call(collectionRoute.GET, 'GET', '?status=all', b.key);
    expect(listed.status).toBe(200);
    expect(listed.json.data).toEqual([]);

    const reads: Array<[RouteHandler, string]> = [
      [definitionRoute.GET, `/${definitionId}`],
      [upcomingRoute.GET, `/${definitionId}/upcoming`],
      [occurrencesRoute.GET, `/${definitionId}/occurrences`],
    ];
    for (const [handler, path] of reads) {
      const response = await call(handler, 'GET', path, b.key);
      expect(response.status, `GET ${path}`).toBe(404);
    }

    const writes: Array<[RouteHandler, string, string, unknown?]> = [
      [definitionRoute.PUT, 'PUT', `/${definitionId}`, apnsDefinition(b, { name: 'hijacked' })],
      [definitionRoute.DELETE, 'DELETE', `/${definitionId}`],
      [pauseRoute.POST, 'POST', `/${definitionId}/pause`],
      [resumeRoute.POST, 'POST', `/${definitionId}/resume`],
      [clientsRoute.POST, 'POST', `/${definitionId}/clients`, { client_ids: [b.clientId] }],
      [clientRoute.PUT, 'PUT', `/${definitionId}/clients/${a.clientId}`, { overrides: {}, contact_id: null, location_id: null, asset_ids: [] }],
      [clientPauseRoute.POST, 'POST', `/${definitionId}/clients/${a.clientId}/pause`],
      [clientResumeRoute.POST, 'POST', `/${definitionId}/clients/${a.clientId}/resume`],
      [clientRoute.DELETE, 'DELETE', `/${definitionId}/clients/${a.clientId}`],
    ];
    for (const [handler, method, path, body] of writes) {
      const response = await call(handler, method, path, b.key, body);
      expect(response.status, `${method} ${path}`).toBe(404);
    }

    // Tenant A's record is exactly as it was.
    const [definition] = await tenantDb(testDb, a.tenant).table('recurring_ticket_definitions').where({ definition_id: definitionId });
    expect(definition).toMatchObject({ name: 'Apple APNs certificate renewal', is_active: true, archived_at: null });
    const clients = await tenantDb(testDb, a.tenant).table('recurring_ticket_definition_clients').where({ definition_id: definitionId });
    expect(clients.map((c: any) => [c.client_id, c.is_active])).toEqual([[a.clientId, true]]);
    expect(await tenantDb(testDb, b.tenant).table('recurring_ticket_definition_clients').select('*')).toEqual([]);

    // A tenant B definition cannot adopt a tenant A client either.
    const ownDefinition = await createApns(b);
    const foreignClient = await call(clientsRoute.POST, 'POST', `/${ownDefinition}/clients`, b.key, { client_ids: [a.clientId] });
    expect(foreignClient.status).toBe(400);
    expect(await tenantDb(testDb, b.tenant).table('recurring_ticket_definition_clients').select('*')).toEqual([]);
  });

  it('an unknown API key is 401 and a key pinned to another tenant is 401', async () => {
    expect((await call(collectionRoute.GET, 'GET', '', 'nope')).status).toBe(401);
    const request = new NextRequest('http://localhost/api/v1/tickets/recurring', {
      headers: { 'x-api-key': a.key, 'x-tenant-id': b.tenant },
    });
    expect((await collectionRoute.GET(request as any)).status).toBe(401);
  });
});
