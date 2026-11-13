/**
 * T019 (alga-2026-0003215, S18, F032-F034): REST and MCP return only in-scope records.
 *
 * Approach: the real Next.js route handlers (and the real MCP JSON-RPC handler) run against the migrated PostgreSQL
 * schema with real API keys, the real authorization kernel and real bundle resolution. Only the connection factories
 * (pointed at one disposable transaction), rate limiting, event publishing and the MCP loopback `fetch` (routed to
 * the same route handlers in-process) are stood in for.
 *
 * Fixture: two clients (A, B) each with contacts, interactions, tickets, a project task with a comment, time entries
 * on their tickets, and search-index rows; one time sheet carrying entries of both clients. Key "narrowed" has a
 * bundle naming only client A assigned to the key; key "control" has no bundle. Both belong to users with the same role.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTestApiKey } from '../../e2e/utils/apiTestHelpers';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';

const connection = vi.hoisted(() => ({ db: undefined as Knex | undefined, tenant: '' }));

vi.mock('@alga-psa/db', async (original) => ({
  ...(await original<typeof import('@alga-psa/db')>()),
  getConnection: async () => connection.db!,
  getAdminConnection: async () => connection.db!,
  createTenantKnex: async (tenant?: string) => ({ knex: connection.db!, tenant: tenant ?? connection.tenant }),
}));
vi.mock('@alga-psa/db/admin', async (original) => ({
  ...(await original<typeof import('@alga-psa/db/admin')>()),
  getAdminConnection: async () => connection.db!,
}));
vi.mock('@/lib/db/db', async (original) => ({
  ...(await original<typeof import('@/lib/db/db')>()),
  getConnection: async () => connection.db!,
}));
vi.mock('../../../../../packages/db/src/lib/tenant', async (original) => ({
  ...(await original<typeof import('../../../../../packages/db/src/lib/tenant')>()),
  createTenantKnex: async () => ({ knex: connection.db!, tenant: connection.tenant }),
}));
vi.mock('@alga-psa/auth', async () => {
  const { ApiKeyService, shouldTouchApiKeyLastUsed } = await import('../../../../../packages/auth/src/services/apiKeyService');
  const actual = await vi.importActual<typeof import('@alga-psa/auth')>('@alga-psa/auth');
  return { ...actual, ApiKeyService, shouldTouchApiKeyLastUsed };
});
vi.mock('@/lib/api/rateLimit/enforce', () => ({ enforceApiRateLimit: async () => null }));
vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('next/server', async () => ({
  ...(await import('next/dist/server/web/spec-extension/request')),
  ...(await import('next/dist/server/web/spec-extension/response')),
}));

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Caller = { userId: string; apiKey: string; apiKeyId: string };

const HOOK_TIMEOUT = 900_000;
const TERM = 'zorblaxrest';
const PERMISSIONS: Array<[string, string[]]> = [
  ['client', ['read', 'create', 'update', 'delete']],
  ['contact', ['read', 'create', 'update', 'delete']],
  ['interaction', ['read', 'create', 'update']],
  ['time_entry', ['read', 'create', 'update', 'delete']],
  ['time_sheet', ['read', 'create', 'update']],
  ['ticket', ['read', 'create', 'update', 'delete']],
  ['project', ['read']],
  ['project_task', ['read', 'create', 'update', 'delete']],
  ['document', ['read', 'create']],
  ['time', ['read']],
];
/** Resources the bundle narrows to client A (read rules also decide create, per the create gate). */
const NARROWED_RESOURCES = ['client', 'contact', 'interaction', 'time_entry', 'ticket', 'project'];

let db: Knex;
let tenant: string;
let reindexSearch: () => Promise<unknown>;
const routes = {} as Record<string, Handler>;
const ids = {
  admin: '', owner: '', controlOwner: '',
  A: { client: '', contacts: [] as string[], interactions: [] as string[], tickets: [] as string[], project: '', task: '', entries: [] as string[] },
  B: { client: '', contacts: [] as string[], interactions: [] as string[], tickets: [] as string[], project: '', task: '', entries: [] as string[] },
  emptyPeriod: '', board: '', status: '', priority: '', projectStatus: '', interactionType: '', period: '', sheet: '', controlSheet: '', service: '',
};
let narrowed: Caller;
let previousKernel: unknown;
let control: Caller;
let bundleId = '';

const insert = (table: string, row: Record<string, unknown>) => connection.db!(table).insert({ tenant, ...row });

function request(caller: Caller, path: string, method = 'GET', body?: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'x-api-key': caller.apiKey, 'x-tenant-id': tenant, ...(body ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(JSON.stringify(body))) } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function call(handler: Handler, caller: Caller, path: string, method = 'GET', body?: Record<string, unknown>, params: Record<string, string> = {}) {
  const response = await handler(request(caller, path, method, body), { params: Promise.resolve(params) });
  const text = await response.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, json };
}

/** A list endpoint's rows and the total it reports. */
async function list(route: string, caller: Caller, query = '') {
  const { status, json } = await call(routes[route], caller, `/api/v1/${route}${query ? `?${query}` : ''}`);
  expect(status, `${route} list ${JSON.stringify(json)}`).toBe(200);
  return { rows: json.data as any[], total: json.pagination.total as number, json };
}

async function createCaller(userId: string, label: string): Promise<Caller> {
  const key = await createTestApiKey(connection.db!, userId, tenant, label);
  return { userId, apiKey: key.api_key, apiKeyId: key.api_key_id };
}

async function createUser(label: string, roleId: string): Promise<string> {
  const userId = randomUUID();
  await insert('users', {
    user_id: userId, username: `${label}-${userId}`, email: `${userId}@example.test`, first_name: label, last_name: 'Tester',
    hashed_password: 'not-used', user_type: 'internal', is_inactive: false,
  });
  await insert('user_roles', { user_id: userId, role_id: roleId });
  return userId;
}

async function publishRules(
  name: string,
  rules: Array<{ resourceType: string; config: Record<string, unknown>; constraintKey?: string }>,
  target: Caller
) {
  const bundle = await createAuthorizationBundle(connection.db!, { tenant, name, actorUserId: ids.admin });
  for (const rule of rules) {
    await upsertBundleRule(connection.db!, {
      tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId,
      resourceType: rule.resourceType, action: 'read', templateKey: 'selected_clients',
      ...(rule.constraintKey ? { constraintKey: rule.constraintKey } : {}),
      config: rule.config, actorUserId: ids.admin,
    });
  }
  await publishBundleRevision(connection.db! as any, { tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId, actorUserId: ids.admin });
  await createBundleAssignment(connection.db!, {
    tenant, bundleId: bundle.bundleId, targetType: 'api_key', targetId: target.apiKeyId, actorUserId: ids.admin,
  });
  return bundle.bundleId;
}

async function seedClient(label: 'A' | 'B', contacts: number, interactions: number, tickets: number) {
  const side = ids[label];
  side.client = randomUUID();
  await insert('clients', { client_id: side.client, client_name: `${TERM} client ${label}`, billing_cycle: 'monthly', is_tax_exempt: false });
  for (let i = 0; i < contacts; i++) {
    const id = randomUUID();
    side.contacts.push(id);
    await insert('contacts', { contact_name_id: id, full_name: `${TERM} contact ${label}${i}`, client_id: side.client, email: `c${label}${i}-${id}@example.test` });
  }
  for (let i = 0; i < interactions; i++) {
    const id = randomUUID();
    side.interactions.push(id);
    await insert('interactions', {
      interaction_id: id, type_id: ids.interactionType, client_id: side.client, user_id: ids.admin,
      title: `${TERM} interaction ${label}${i}`, notes: `n${i}`, interaction_date: new Date(`2026-01-06T1${i}:00:00Z`),
    });
  }
  for (let i = 0; i < tickets; i++) {
    const id = randomUUID();
    side.tickets.push(id);
    await insert('tickets', {
      ticket_id: id, ticket_number: `T-${label}${i}-${id.slice(0, 6)}`, title: `${TERM} ticket ${label}${i}`,
      client_id: side.client, board_id: ids.board, status_id: ids.status, priority_id: ids.priority, entered_by: ids.admin,
    });
  }
  side.project = randomUUID();
  await insert('projects', {
    project_id: side.project, project_name: `${TERM} project ${label}`, client_id: side.client, status: ids.projectStatus,
    wbs_code: label === 'A' ? '1' : '2', project_number: `P-${label}-${side.project.slice(0, 6)}`, is_inactive: false,
  });
  const phase = randomUUID();
  await insert('project_phases', { phase_id: phase, project_id: side.project, phase_name: `Phase ${label}`, status: 'active', order_number: 1, wbs_code: `${label === 'A' ? 1 : 2}.1` });
  side.task = randomUUID();
  await insert('project_tasks', { task_id: side.task, phase_id: phase, task_name: `Task ${label}`, wbs_code: `${label === 'A' ? 1 : 2}.1.1` });
  // Two time entries per client, owned by the narrowed key's user, on the client's tickets.
  for (let i = 0; i < 2; i++) {
    const id = randomUUID();
    side.entries.push(id);
    const hour = (label === 'A' ? 0 : 4) + i * 2;
    await insert('time_entries', {
      entry_id: id, user_id: ids.owner, time_sheet_id: ids.sheet, work_item_type: 'ticket', work_item_id: side.tickets[i],
      start_time: new Date(Date.UTC(2026, 0, 6, hour, 0, 0)), end_time: new Date(Date.UTC(2026, 0, 6, hour + 1, 0, 0)),
      work_date: '2026-01-06', work_timezone: 'UTC', billable_duration: 60, notes: `${TERM} entry ${label}${i}`, approval_status: 'DRAFT',
    });
  }
}

beforeAll(async () => {
  process.env.APP_ENV = process.env.APP_ENV || 'test';
  db = await createTestDbConnection({ runSeeds: false });
  tenant = randomUUID();
  connection.tenant = tenant;
  const tenantRow: Record<string, unknown> = { tenant, company_name: 'REST MCP scope', email: `${tenant}@example.test`, product_code: 'psa', created_at: db.fn.now(), updated_at: db.fn.now() };
  const cols = await db('tenants').columnInfo();
  if (!('company_name' in cols)) { delete tenantRow.company_name; tenantRow.client_name = 'REST MCP scope'; }
  if (!('product_code' in cols)) delete tenantRow.product_code;
  await db('tenants').insert(tenantRow);
  connection.db = await db.transaction();

  // Bundle rules reach the per-row kernel (ticket detail, mutations) only through the enterprise kernel; the CE kernel
  // has no bundle provider. List narrowing (SQL) does not depend on the kernel.
  previousKernel = (globalThis as any).__algaAuthorizationKernelSingleton;
  const { createEnterpriseAuthorizationKernel } = await import('../../../../../ee/server/src/lib/authorization/kernel');
  (globalThis as any).__algaAuthorizationKernelSingleton = await createEnterpriseAuthorizationKernel();

  const roleId = randomUUID();
  await insert('roles', { role_id: roleId, role_name: `rest-mcp-${roleId}`, msp: true, client: false });
  for (const [resource, actions] of PERMISSIONS) {
    for (const action of actions) {
      let permission = await connection.db('permissions').where({ tenant, resource, action }).first('permission_id');
      if (!permission) {
        const permissionId = randomUUID();
        await insert('permissions', { permission_id: permissionId, resource, action, msp: true, client: false });
        permission = { permission_id: permissionId };
      }
      await insert('role_permissions', { role_id: roleId, permission_id: permission.permission_id });
    }
  }
  ids.admin = await createUser('Admin', roleId);
  ids.owner = await createUser('Narrowed', roleId);
  ids.controlOwner = await createUser('Control', roleId);

  ids.board = randomUUID(); ids.status = randomUUID(); ids.priority = randomUUID(); ids.projectStatus = randomUUID();
  ids.interactionType = randomUUID(); ids.period = randomUUID(); ids.sheet = randomUUID(); ids.controlSheet = randomUUID();
  await insert('boards', { board_id: ids.board, board_name: 'Support', is_default: true, is_inactive: false });
  await insert('priorities', { priority_id: ids.priority, priority_name: 'High', item_type: 'ticket', color: '#EF4444', order_number: 10, created_by: ids.admin });
  await insert('statuses', { status_id: ids.status, board_id: ids.board, name: 'Open', status_type: 'ticket', is_closed: false, is_default: true, order_number: 10, created_by: ids.admin });
  await insert('statuses', { status_id: ids.projectStatus, name: 'Active', status_type: 'project', is_closed: false, is_default: true, order_number: 10, created_by: ids.admin });
  await insert('statuses', { status_id: randomUUID(), name: 'Open', status_type: 'interaction', is_closed: false, is_default: true, order_number: 10, created_by: ids.admin });
  await insert('interaction_types', { type_id: ids.interactionType, type_name: `Call ${ids.interactionType.slice(0, 6)}` });
  await insert('time_periods', { period_id: ids.period, start_date: '2026-01-05', end_date: '2026-01-12' });
  await insert('time_sheets', { id: ids.sheet, user_id: ids.owner, period_id: ids.period, approval_status: 'DRAFT' });
  // A period nobody has a sheet for: a refused create there must not leave one behind.
  ids.emptyPeriod = randomUUID();
  await insert('time_periods', { period_id: ids.emptyPeriod, start_date: '2026-02-02', end_date: '2026-02-09' });
  await insert('time_sheets', { id: ids.controlSheet, user_id: ids.controlOwner, period_id: ids.period, approval_status: 'DRAFT' });
  const serviceTypeId = randomUUID();
  await insert('service_types', { id: serviceTypeId, name: `rest-mcp-type-${serviceTypeId.slice(0, 6)}`, is_active: true });
  ids.service = randomUUID();
  await insert('service_catalog', { service_id: ids.service, service_name: `rest-mcp-svc-${ids.service.slice(0, 6)}`, billing_method: 'hourly', custom_service_type_id: serviceTypeId });

  await seedClient('A', 3, 3, 3);
  await seedClient('B', 2, 2, 2);

  narrowed = await createCaller(ids.owner, 'narrowed key');
  control = await createCaller(ids.controlOwner, 'control key');

  // Routes (the real handlers).
  routes.clients = (await import('../../../app/api/v1/clients/route')).GET as Handler;
  routes['clients:post'] = (await import('../../../app/api/v1/clients/route')).POST as Handler;
  routes['clients/[id]'] = (await import('../../../app/api/v1/clients/[id]/route')).GET as Handler;
  routes.contacts = (await import('../../../app/api/v1/contacts/route')).GET as Handler;
  routes['contacts:post'] = (await import('../../../app/api/v1/contacts/route')).POST as Handler;
  routes['contacts/[id]'] = (await import('../../../app/api/v1/contacts/[id]/route')).GET as Handler;
  routes.interactions = (await import('../../../app/api/v1/interactions/route')).GET as Handler;
  routes['interactions:post'] = (await import('../../../app/api/v1/interactions/route')).POST as Handler;
  routes['interactions/[id]'] = (await import('../../../app/api/v1/interactions/[id]/route')).GET as Handler;
  routes['time-entries'] = (await import('../../../app/api/v1/time-entries/route')).GET as Handler;
  routes['time-entries:post'] = (await import('../../../app/api/v1/time-entries/route')).POST as Handler;
  routes['time-entries/[id]'] = (await import('../../../app/api/v1/time-entries/[id]/route')).GET as Handler;
  routes['time-sheets'] = (await import('../../../app/api/v1/time-sheets/route')).GET as Handler;
  routes['time-sheets/[id]'] = (await import('../../../app/api/v1/time-sheets/[id]/route')).GET as Handler;
  routes.tickets = (await import('../../../app/api/v1/tickets/route')).GET as Handler;
  routes['tickets:post'] = (await import('../../../app/api/v1/tickets/route')).POST as Handler;
  routes['tickets/[id]'] = (await import('../../../app/api/v1/tickets/[id]/route')).GET as Handler;
  routes['documents:post'] = (await import('../../../app/api/v1/documents/route')).POST as Handler;
  routes.search = (await import('../../../app/api/v1/search/route')).GET as Handler;
  const comments = await import('../../../app/api/v1/projects/tasks/[taskId]/comments/route');
  routes['comments'] = comments.GET as Handler;
  routes['comments:post'] = comments.POST as Handler;

  // A comment on each client's task, written by the unbundled key (no bundle exists yet).
  for (const side of [ids.A, ids.B]) {
    const created = await call(routes['comments:post'], control, `/api/v1/projects/tasks/${side.task}/comments`, 'POST', { note: `${TERM} comment` }, { taskId: side.task });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
  }

  // Search index rows for every record, then the per-tenant client-scope fill (as the S17 job does).
  const { getIndexer } = await import('@alga-psa/search');
  const { upsertSearchDoc } = await import('@alga-psa/search/upsert');
  const { runWithTenant } = await import('@alga-psa/db');
  const { searchClientScopeReindexHandler } = await import('../../../lib/jobs/handlers/searchClientScopeReindexHandler');
  const indexAll = async () => {
    for (const side of [ids.A, ids.B]) {
      const targets: Array<[string, string]> = [
        ['client', side.client],
        ...side.contacts.map((id): [string, string] => ['contact', id]),
        ...side.interactions.map((id): [string, string] => ['interaction', id]),
        ...side.tickets.map((id): [string, string] => ['ticket', id]),
        ...side.entries.map((id): [string, string] => ['time_entry', id]),
      ];
      for (const [type, id] of targets) {
        const doc = await getIndexer(type as any)!.loadOne(connection.db!, tenant, id);
        if (doc) await upsertSearchDoc(connection.db!, doc);
      }
    }
  };
  await indexAll();
  reindexSearch = () => runWithTenant(tenant, () => searchClientScopeReindexHandler({ tenantId: tenant, batchSize: 50 }));
  await reindexSearch();

  // The bundle: client A only, assigned to the narrowed key and to no one else.
  bundleId = await publishRules('S18 client A only', NARROWED_RESOURCES.map((resourceType) => ({
    resourceType, config: { selectedClientIds: [ids.A.client] },
  })), narrowed);
}, HOOK_TIMEOUT);

afterAll(async () => {
  (globalThis as any).__algaAuthorizationKernelSingleton = previousKernel;
  await (connection.db as Knex.Transaction | undefined)?.rollback().catch(() => undefined);
  if (db) {
    await db('tenants').where({ tenant }).del().catch(() => undefined);
    await db.destroy();
  }
}, HOOK_TIMEOUT);

const idsOf = (rows: any[], key: string) => rows.map((row) => row[key]).sort();

// Tests run in any order and some create records, so every expectation is read from the database at assertion time:
// "what the narrowed key may see" is the rows of client A, "what the control key may see" is every row.
const dbIds = async (table: string, idColumn: string, where: Record<string, unknown> = {}) =>
  ((await connection.db!(table).where({ tenant, ...where }).pluck(idColumn)) as string[]).sort();
const clientAIds = (table: string, idColumn: string) => dbIds(table, idColumn, { client_id: ids.A.client });
const timeEntryIdsOfClient = async (clientId: string) => {
  const tickets = (await connection.db!('tickets').where({ tenant, client_id: clientId }).pluck('ticket_id')) as string[];
  return ((await connection.db!('time_entries').where({ tenant, work_item_type: 'ticket' }).whereIn('work_item_id', tickets).pluck('entry_id')) as string[]).sort();
};

describe('T019: REST and MCP return only in-scope records', () => {
  describe('F032/F033/F034: lists and gets through the real route handlers', () => {
    it('clients: the narrowed key sees client A only; the control key sees both; get of B is a 404', async () => {
      const narrowedList = await list('clients', narrowed);
      expect(idsOf(narrowedList.rows, 'client_id')).toEqual([ids.A.client]);
      expect(narrowedList.total).toBe(1);

      const controlList = await list('clients', control);
      expect(idsOf(controlList.rows, 'client_id')).toEqual([ids.A.client, ids.B.client].sort());
      expect(controlList.total).toBe(2);

      expect((await call(routes['clients/[id]'], narrowed, `/api/v1/clients/${ids.A.client}`, 'GET', undefined, { id: ids.A.client })).status).toBe(200);
      expect((await call(routes['clients/[id]'], narrowed, `/api/v1/clients/${ids.B.client}`, 'GET', undefined, { id: ids.B.client })).status).toBe(404);
      expect((await call(routes['clients/[id]'], control, `/api/v1/clients/${ids.B.client}`, 'GET', undefined, { id: ids.B.client })).status).toBe(200);
    });

    it('contacts: only client A contacts, total and pagination over the narrowed set', async () => {
      const all = await list('contacts', narrowed, 'limit=100');
      const inA = await clientAIds('contacts', 'contact_name_id');
      expect(idsOf(all.rows, 'contact_name_id')).toEqual(inA);
      expect(all.total).toBe(inA.length);

      const first = await list('contacts', narrowed, 'limit=2&page=1');
      const second = await list('contacts', narrowed, 'limit=2&page=2');
      expect(first.rows).toHaveLength(2);
      expect(second.rows).toHaveLength(inA.length - 2);
      expect(first.total).toBe(inA.length);
      expect(second.total).toBe(inA.length);
      expect(first.json.pagination.totalPages).toBe(Math.ceil(inA.length / 2));
      expect(new Set([...first.rows, ...second.rows].map((row) => row.contact_name_id))).toEqual(new Set(inA));

      expect((await list('contacts', control, 'limit=100')).total).toBe((await dbIds('contacts', 'contact_name_id')).length);
      const hiddenId = ids.B.contacts[0];
      expect((await call(routes['contacts/[id]'], narrowed, `/api/v1/contacts/${hiddenId}`, 'GET', undefined, { id: hiddenId })).status).toBe(404);
      expect((await call(routes['contacts/[id]'], narrowed, `/api/v1/contacts/${ids.A.contacts[0]}`, 'GET', undefined, { id: ids.A.contacts[0] })).status).toBe(200);
      expect((await call(routes['contacts/[id]'], control, `/api/v1/contacts/${hiddenId}`, 'GET', undefined, { id: hiddenId })).status).toBe(200);
    });

    it('interactions: only client A interactions, with the narrowed total', async () => {
      const result = await list('interactions', narrowed, 'page_size=100');
      const inA = await clientAIds('interactions', 'interaction_id');
      expect(idsOf(result.rows, 'interaction_id')).toEqual(inA);
      expect(result.total).toBe(inA.length);

      const second = await list('interactions', narrowed, 'page_size=2&page=2');
      expect(second.rows).toHaveLength(inA.length - 2);
      expect(second.total).toBe(inA.length);

      expect((await list('interactions', control, 'page_size=100')).total).toBe((await dbIds('interactions', 'interaction_id')).length);
      const hiddenId = ids.B.interactions[0];
      expect((await call(routes['interactions/[id]'], narrowed, `/api/v1/interactions/${hiddenId}`, 'GET', undefined, { id: hiddenId })).status).toBe(404);
      expect((await call(routes['interactions/[id]'], narrowed, `/api/v1/interactions/${ids.A.interactions[0]}`, 'GET', undefined, { id: ids.A.interactions[0] })).status).toBe(200);
      expect((await call(routes['interactions/[id]'], control, `/api/v1/interactions/${hiddenId}`, 'GET', undefined, { id: hiddenId })).status).toBe(200);
    });

    it('time entries: only entries on client A work, total and pages over the narrowed set', async () => {
      const result = await list('time-entries', narrowed, 'limit=100');
      const inA = await timeEntryIdsOfClient(ids.A.client);
      expect(idsOf(result.rows, 'entry_id')).toEqual(inA);
      expect(result.total).toBe(inA.length);
      const page2 = await list('time-entries', narrowed, 'limit=1&page=2');
      expect(page2.rows).toHaveLength(1);
      expect(page2.total).toBe(inA.length);

      expect((await list('time-entries', control, 'limit=100')).total).toBe((await dbIds('time_entries', 'entry_id')).length);
      const hiddenId = ids.B.entries[0];
      expect((await call(routes['time-entries/[id]'], narrowed, `/api/v1/time-entries/${hiddenId}`, 'GET', undefined, { id: hiddenId })).status).toBe(404);
      expect((await call(routes['time-entries/[id]'], narrowed, `/api/v1/time-entries/${ids.A.entries[0]}`, 'GET', undefined, { id: ids.A.entries[0] })).status).toBe(200);
      expect((await call(routes['time-entries/[id]'], control, `/api/v1/time-entries/${hiddenId}`, 'GET', undefined, { id: hiddenId })).status).toBe(200);
    });

    it('time sheets: the entries a sheet lists, counts and sums are the in-scope ones', async () => {
      const result = await list('time-sheets', narrowed, 'limit=100');
      const sheet = result.rows.find((row) => row.id === ids.sheet);
      expect(sheet, 'the sheet is listed').toBeTruthy();
      const inA = await timeEntryIdsOfClient(ids.A.client);
      const inSheet = await dbIds('time_entries', 'entry_id', { time_sheet_id: ids.sheet });
      const sheetInA = inSheet.filter((id) => inA.includes(id));
      expect(sheetInA.length).toBeGreaterThanOrEqual(2);
      expect(inSheet.length).toBeGreaterThan(sheetInA.length);
      expect(Number(sheet.entry_count)).toBe(sheetInA.length);
      const billableMinutes = (await connection.db!('time_entries').where({ tenant }).whereIn('entry_id', sheetInA).sum('billable_duration as m'))[0].m;
      expect(Number(sheet.total_hours)).toBeCloseTo(Number(billableMinutes) / 60, 5);
      expect(result.total).toBe(2);

      const controlSheet = (await list('time-sheets', control, 'limit=100')).rows.find((row) => row.id === ids.sheet);
      expect(Number(controlSheet.entry_count)).toBe(inSheet.length);

      const detail = await call(routes['time-sheets/[id]'], narrowed, `/api/v1/time-sheets/${ids.sheet}`, 'GET', undefined, { id: ids.sheet });
      expect(detail.status, JSON.stringify(detail.json)).toBe(200);
      expect(idsOf(detail.json.data.time_entries, 'entry_id')).toEqual(sheetInA);
    });

    it('tickets: only client A tickets, total and pages over the narrowed set', async () => {
      const result = await list('tickets', narrowed, 'limit=100');
      const inA = await clientAIds('tickets', 'ticket_id');
      expect(idsOf(result.rows, 'ticket_id')).toEqual(inA);
      expect(result.total).toBe(inA.length);
      const second = await list('tickets', narrowed, 'limit=2&page=2');
      expect(second.rows).toHaveLength(inA.length - 2);
      expect(second.total).toBe(inA.length);

      expect((await list('tickets', control, 'limit=100')).total).toBe((await dbIds('tickets', 'ticket_id')).length);
      const hiddenId = ids.B.tickets[0];
      expect([403, 404]).toContain((await call(routes['tickets/[id]'], narrowed, `/api/v1/tickets/${hiddenId}`, 'GET', undefined, { id: hiddenId })).status);
      expect((await call(routes['tickets/[id]'], narrowed, `/api/v1/tickets/${ids.A.tickets[0]}`, 'GET', undefined, { id: ids.A.tickets[0] })).status).toBe(200);
      expect((await call(routes['tickets/[id]'], control, `/api/v1/tickets/${hiddenId}`, 'GET', undefined, { id: hiddenId })).status).toBe(200);
    });

    it('project task comments: the narrowed key reads comments of a client A task and gets nothing for client B', async () => {
      const inScope = await call(routes.comments, narrowed, `/api/v1/projects/tasks/${ids.A.task}/comments`, 'GET', undefined, { taskId: ids.A.task });
      expect(inScope.status, JSON.stringify(inScope.json)).toBe(200);
      expect(inScope.json.data).toHaveLength(1);
      const outOfScope = await call(routes.comments, narrowed, `/api/v1/projects/tasks/${ids.B.task}/comments`, 'GET', undefined, { taskId: ids.B.task });
      expect(outOfScope.status).toBe(404);
      // The control key is unchanged: both tasks' comments are readable.
      expect((await call(routes.comments, control, `/api/v1/projects/tasks/${ids.B.task}/comments`, 'GET', undefined, { taskId: ids.B.task })).status).toBe(200);
      // And a write to an out-of-scope task's comments is refused as well.
      const write = await call(routes['comments:post'], narrowed, `/api/v1/projects/tasks/${ids.B.task}/comments`, 'POST', { note: 'nope' }, { taskId: ids.B.task });
      expect([403, 404]).toContain(write.status);
    });

    it('search: the narrowed key finds client A records only; the control key finds both clients', async () => {
      const types = 'client,contact,ticket,interaction,time_entry';
      const response = await call(routes.search, narrowed, `/api/v1/search?query=${TERM}&types=${types}&limit=100`);
      expect(response.status, JSON.stringify(response.json)).toBe(200);
      const seen = new Set<string>(response.json.data.results.map((row: any) => row.id));
      const inA = [ids.A.client, ...ids.A.contacts, ...ids.A.interactions, ...ids.A.tickets, ...ids.A.entries];
      const inB = [ids.B.client, ...ids.B.contacts, ...ids.B.interactions, ...ids.B.tickets, ...ids.B.entries];
      for (const id of inA) expect(seen.has(id), `visible ${id}`).toBe(true);
      for (const id of inB) expect(seen.has(id), `hidden ${id}`).toBe(false);
      expect(response.json.data.totalCount).toBe(response.json.data.results.length);

      const controlResponse = await call(routes.search, control, `/api/v1/search?query=${TERM}&types=client,contact,ticket,interaction&limit=100`);
      const controlSeen = new Set<string>(controlResponse.json.data.results.map((row: any) => row.id));
      for (const id of [...inA, ...inB].filter((id) => !ids.A.entries.includes(id) && !ids.B.entries.includes(id))) {
        expect(controlSeen.has(id), `control sees ${id}`).toBe(true);
      }
    });
  });

  describe('F032: creating a record for a client outside the key\'s scope', () => {
    it('is refused with 403 on every create path, and allowed for client A and for the control key', async () => {
      const contactBody = (clientId: string) => ({ full_name: `${TERM} new contact`, client_id: clientId, email: `new-${randomUUID()}@example.test` });
      expect((await call(routes['contacts:post'], narrowed, '/api/v1/contacts', 'POST', contactBody(ids.B.client))).status).toBe(403);
      const okContact = await call(routes['contacts:post'], narrowed, '/api/v1/contacts', 'POST', contactBody(ids.A.client));
      expect(okContact.status, JSON.stringify(okContact.json)).toBe(201);
      expect((await call(routes['contacts:post'], control, '/api/v1/contacts', 'POST', contactBody(ids.B.client))).status).toBe(201);

      const interactionBody = (clientId: string) => ({ type_id: ids.interactionType, client_id: clientId, title: `${TERM} new interaction` });
      expect((await call(routes['interactions:post'], narrowed, '/api/v1/interactions', 'POST', interactionBody(ids.B.client))).status).toBe(403);
      const okInteraction = await call(routes['interactions:post'], narrowed, '/api/v1/interactions', 'POST', interactionBody(ids.A.client));
      expect(okInteraction.status, JSON.stringify(okInteraction.json)).toBe(201);
      expect((await call(routes['interactions:post'], control, '/api/v1/interactions', 'POST', interactionBody(ids.B.client))).status).toBe(201);

      const ticketBody = (clientId: string) => ({
        title: `${TERM} new ticket`, client_id: clientId, board_id: ids.board, status_id: ids.status, priority_id: ids.priority,
      });
      expect((await call(routes['tickets:post'], narrowed, '/api/v1/tickets', 'POST', ticketBody(ids.B.client))).status).toBe(403);
      const okTicket = await call(routes['tickets:post'], narrowed, '/api/v1/tickets', 'POST', ticketBody(ids.A.client));
      expect(okTicket.status, JSON.stringify(okTicket.json)).toBe(201);
      expect((await call(routes['tickets:post'], control, '/api/v1/tickets', 'POST', ticketBody(ids.B.client))).status).toBe(201);

      const entryBody = (workItemId: string, day: number) => ({
        work_item_type: 'ticket', work_item_id: workItemId, service_id: ids.service, is_billable: false,
        start_time: `2026-01-0${day}T08:00:00.000Z`, end_time: `2026-01-0${day}T09:00:00.000Z`, notes: `${TERM} new entry`,
      });
      const refused = await call(routes['time-entries:post'], narrowed, '/api/v1/time-entries', 'POST', entryBody(ids.B.tickets[0], 7));
      expect(refused.status, JSON.stringify(refused.json)).toBe(403);
      // The refusal changes no data: no time sheet appears for the owner in a period that has none.
      const sheetsIn = async () => (await connection.db!('time_sheets').where({ tenant, user_id: ids.owner, period_id: ids.emptyPeriod }).count('* as c'))[0].c;
      const before = Number(await sheetsIn());
      const refusedNewPeriod = await call(routes['time-entries:post'], narrowed, '/api/v1/time-entries', 'POST',
        { ...entryBody(ids.B.tickets[0], 7), start_time: '2026-02-03T08:00:00.000Z', end_time: '2026-02-03T09:00:00.000Z' });
      expect(refusedNewPeriod.status, JSON.stringify(refusedNewPeriod.json)).toBe(403);
      expect(Number(await sheetsIn())).toBe(before);
      const okEntry = await call(routes['time-entries:post'], narrowed, '/api/v1/time-entries', 'POST', entryBody(ids.A.tickets[0], 7));
      expect(okEntry.status, JSON.stringify(okEntry.json)).toBe(201);
    });
  });

  describe('F032: attaching a document to a client or contact outside the key\'s scope', () => {
    const attach = (caller: Caller, entityType: string, entityId: string) =>
      call(routes['documents:post'], caller, '/api/v1/documents', 'POST', {
        entity_type: entityType, entity_id: entityId, file_name: 'note.txt', mime_type: 'text/plain',
        source: { type: 'base64', content: Buffer.from('s18').toString('base64') },
      });

    it('is a 404 for client B and its contacts, succeeds for client A, and is unchanged for the control key', async () => {
      expect((await attach(narrowed, 'client', ids.B.client)).status).toBe(404);
      expect((await attach(narrowed, 'contact', ids.B.contacts[0])).status).toBe(404);
      const okClient = await attach(narrowed, 'client', ids.A.client);
      expect(okClient.status, JSON.stringify(okClient.json)).toBe(201);
      const okContact = await attach(narrowed, 'contact', ids.A.contacts[0]);
      expect(okContact.status, JSON.stringify(okContact.json)).toBe(201);
      const controlClient = await attach(control, 'client', ids.B.client);
      expect(controlClient.status, JSON.stringify(controlClient.json)).toBe(201);
    });
  });

  describe('F034: totals and pagination when a rule redacts fields', () => {
    it('keeps the narrowed total and pages, and omits the redacted field from list and detail', async () => {
      // A second bundle on the same key: still client A, and it redacts the ticket title.
      await publishRules('S18 redact title', [{
        resourceType: 'ticket', config: { selectedClientIds: [ids.A.client], redactedFields: ['title'] }, constraintKey: 'hide_sensitive_fields',
      }], narrowed);

      const all = await list('tickets', narrowed, 'limit=100');
      const expectedTotal = (await clientAIds('tickets', 'ticket_id')).length;
      expect(expectedTotal).toBeGreaterThanOrEqual(3);
      expect(all.total).toBe(expectedTotal);
      expect(all.rows).toHaveLength(expectedTotal);
      for (const row of all.rows) {
        expect(row.client_id === undefined || row.client_id === ids.A.client).toBe(true);
        expect('title' in row).toBe(false);
        expect(row.ticket_id).toBeTruthy();
      }
      expect(all.rows.every((row) => !ids.B.tickets.includes(row.ticket_id))).toBe(true);

      const first = await list('tickets', narrowed, 'limit=3&page=1');
      const second = await list('tickets', narrowed, 'limit=3&page=2');
      expect(first.rows).toHaveLength(3);
      expect(second.rows).toHaveLength(expectedTotal - 3);
      expect(first.total).toBe(expectedTotal);
      expect(second.total).toBe(expectedTotal);
      expect(first.json.pagination.totalPages).toBe(Math.ceil(expectedTotal / 3));

      const detail = await call(routes['tickets/[id]'], narrowed, `/api/v1/tickets/${ids.A.tickets[0]}`, 'GET', undefined, { id: ids.A.tickets[0] });
      expect(detail.status).toBe(200);
      expect('title' in detail.json.data).toBe(false);

      // The control key is not redacted and not narrowed.
      const controlList = await list('tickets', control, 'limit=100');
      expect(controlList.total).toBe((await dbIds('tickets', 'ticket_id')).length);
      expect(controlList.rows.every((row) => typeof row.title === 'string')).toBe(true);
    });
  });

  describe('F033: MCP search_business_data and call_api_endpoint agree with REST for the same key', () => {
    it('answers through the same narrowed controllers', async () => {
      const { handleMcpJsonRpc } = await import('../../../../../ee/server/src/lib/mcp/jsonRpcServer');
      const dispatch: Array<[string, Handler]> = [
        ['/api/v1/search', routes.search],
        ['/api/v1/contacts', routes.contacts],
        ['/api/v1/clients', routes.clients],
      ];
      // The MCP server reaches REST by loopback HTTP; route it to the same in-process handlers.
      vi.stubGlobal('fetch', async (input: string | URL, init: RequestInit = {}) => {
        const url = new URL(String(input));
        const target = dispatch.find(([path]) => url.pathname === path);
        if (!target) throw new Error(`unrouted MCP loopback ${url.pathname}`);
        const req = new NextRequest(url, { method: init.method ?? 'GET', headers: init.headers as Record<string, string> });
        return target[1](req, { params: Promise.resolve({}) });
      });
      try {
        const mcp = async (caller: Caller, name: string, args: Record<string, unknown>) => {
          const req = new NextRequest('http://localhost/api/mcp', {
            method: 'POST',
            headers: { 'x-api-key': caller.apiKey, 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
          });
          const response = await handleMcpJsonRpc(req);
          const body: any = await response.json();
          expect(body.error, JSON.stringify(body)).toBeUndefined();
          return JSON.parse(body.result.content[0].text);
        };

        const search = await mcp(narrowed, 'search_business_data', { query: TERM, types: ['client', 'contact', 'ticket', 'interaction'], limit: 100 });
        const restSearch = await call(routes.search, narrowed, `/api/v1/search?query=${TERM}&types=client,contact,ticket,interaction&limit=100`);
        expect(new Set(search.data.results.map((row: any) => row.id))).toEqual(new Set(restSearch.json.data.results.map((row: any) => row.id)));
        for (const id of [ids.B.client, ...ids.B.contacts, ...ids.B.tickets, ...ids.B.interactions]) {
          expect(search.data.results.some((row: any) => row.id === id), `MCP search hides ${id}`).toBe(false);
        }
        expect(search.data.results.some((row: any) => row.id === ids.A.client)).toBe(true);

        const contacts = await mcp(narrowed, 'call_api_endpoint', { entryId: 'get-_api_v1_contacts', query: { limit: 100 } });
        expect(contacts.status).toBe(200);
        const restContacts = await list('contacts', narrowed, 'limit=100');
        expect(idsOf(contacts.data.data, 'contact_name_id')).toEqual(idsOf(restContacts.rows, 'contact_name_id'));
        expect(contacts.data.pagination.total).toBe(restContacts.total);
        expect(contacts.data.data.some((row: any) => ids.B.contacts.includes(row.contact_name_id))).toBe(false);

        const clients = await mcp(narrowed, 'call_api_endpoint', { entryId: 'get-_api_v1_clients' });
        expect(idsOf(clients.data.data, 'client_id')).toEqual([ids.A.client]);

        // The unbundled key through MCP is unchanged.
        const controlClients = await mcp(control, 'call_api_endpoint', { entryId: 'get-_api_v1_clients' });
        expect(idsOf(controlClients.data.data, 'client_id')).toEqual([ids.A.client, ids.B.client].sort());
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it('control: a key with no bundle sees every record, as before', async () => {
    expect((await list('clients', control)).total).toBe(2);
    expect((await list('contacts', control, 'limit=100')).total).toBe((await dbIds('contacts', 'contact_name_id')).length);
    expect((await list('interactions', control, 'page_size=100')).total).toBe((await dbIds('interactions', 'interaction_id')).length);
    expect((await list('tickets', control, 'limit=100')).total).toBe((await dbIds('tickets', 'ticket_id')).length);
    expect(bundleId).toBeTruthy();
  });
});
