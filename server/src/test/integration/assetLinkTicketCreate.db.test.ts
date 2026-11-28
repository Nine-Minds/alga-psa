/**
 * Asset links on ticket create, on real Postgres: addTicket and createTicketFromAsset may link an asset only when the
 * actor may update that asset (record-level) and the asset belongs to the ticket's client. Nothing about permissions
 * is mocked; only the session is injected.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const dbRef = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '' }));
/** The signed-in principal of the request being made. */
const session = vi.hoisted(() => ({ user: null as any }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
  getConnection: vi.fn(async () => dbRef.knex),
}));

vi.mock('@alga-psa/db/tenant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db/tenant')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

// The session only. `hasPermission` stays the real one and reads the principal's role rows.
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  withAuth: (action: any) => (...args: any[]) => action(session.user, { tenant: dbRef.tenant }, ...args),
  withOptionalAuth: (action: any) => (...args: any[]) => action(session.user, { tenant: dbRef.tenant }, ...args),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/event-bus', () => ({
  getEventBus: vi.fn(() => ({ publish: vi.fn() })),
  ServerEventPublisher: class {},
}));

vi.mock('@alga-psa/analytics', () => ({
  captureAnalytics: vi.fn(),
  ServerAnalyticsTracker: class {},
  analytics: { capture: vi.fn() },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('../../../../packages/tickets/src/lib/liveUpdates', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publishTicketUpdate: vi.fn(),
}));


import '@alga-psa/co-managed/capability';
import { registerCapabilityParticipation } from '@alga-psa/core/capability';
import { coManagedSeatParticipants } from '@alga-psa/co-managed/seatCapability';
import { createCoManagedSeatArrangement, setCoManagedSeatBoardScope } from '@alga-psa/co-managed';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
import { tenantDb } from '@alga-psa/db';
import { addTicket, createTicketFromAsset } from '../../../../packages/tickets/src/actions/ticketActions';
import { assertTicketAssetLinksAllowed } from '../../../../packages/tickets/src/lib/ticketAssetLinkAuthorization';
import { insertTestAssets } from '../../../../shared/test-utils/assetFixtures';
import { createCloseRulesFixture, type CloseRulesFixture } from './helpers/closeRulesFixture';

const HOOK_TIMEOUT = 240_000;
const DAY = 86_400_000;

let db: Knex;
let fixture: CloseRulesFixture;
let mspUser: any;
let technician: any;
let linker: any;
let noAssetUser: any;
let otherClientId: string;
let ownAsset: string;
let otherAsset: string;

const tenant = () => fixture.tenantId;

async function principal(userId: string): Promise<any> {
  const user = await db('users').where({ tenant: dbRef.tenant, user_id: userId }).first();
  const roles = await db('user_roles as ur').join('roles as r', function () {
    this.on('r.tenant', 'ur.tenant').andOn('r.role_id', 'ur.role_id');
  }).where({ 'ur.tenant': dbRef.tenant, 'ur.user_id': userId }).select('r.*');
  return { ...user, roles };
}

async function createUser(label: string, grants: Array<[string, string]>): Promise<string> {
  const roleId = randomUUID();
  await db('roles').insert({ tenant: tenant(), role_id: roleId, role_name: `AL ${label} ${roleId.slice(0, 8)}`, msp: true, client: false });
  for (const [resource, action] of grants) {
    const permission = await db('permissions').where({ tenant: tenant(), resource, action, msp: true }).first();
    expect(permission, `${resource}:${action}`).toBeTruthy();
    await db('role_permissions').insert({ tenant: tenant(), role_id: roleId, permission_id: permission.permission_id });
  }
  const userId = randomUUID();
  await db('users').insert({ tenant: tenant(), user_id: userId, username: `al-${userId.slice(0, 8)}`, first_name: label, last_name: 'User',
    hashed_password: 'not-used', user_type: 'internal', email: `al-${userId.slice(0, 8)}@example.com` });
  await db('user_roles').insert({ tenant: tenant(), user_id: userId, role_id: roleId });
  return userId;
}

async function as<T>(user: any, request: () => Promise<T>): Promise<T> {
  session.user = user;
  try {
    return await request();
  } finally {
    session.user = null;
  }
}

function createForm(fields: Record<string, string>): FormData {
  const form = new FormData();
  const values: Record<string, string> = {
    title: `AL ticket ${randomUUID().slice(0, 8)}`, description: 'Asset link on create',
    client_id: fixture.clientId, contact_name_id: fixture.contactId, board_id: fixture.boardId,
    status_id: fixture.openStatusId, priority_id: fixture.priorityId, ...fields,
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

type Outcome = { ok: true; ticketId: string } | { ok: false; message: string };
const settle = async (run: () => Promise<any>): Promise<Outcome> => {
  try {
    const result = await run();
    if (result?.ticket_id) return { ok: true, ticketId: result.ticket_id };
    return { ok: false, message: JSON.stringify(result) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};
const create = (user: any, fields: Record<string, string>) => settle(() => as(user, () => addTicket(createForm(fields))));
const ticketCount = async () => Number((await db('tickets').where({ tenant: tenant() }).count('* as n').first())!.n);
const linkCount = async () => Number((await db('asset_associations').where({ tenant: tenant(), entity_type: 'ticket' }).count('* as n').first())!.n);

beforeAll(async () => {
  db = await createTestDbConnection({ databaseName: 'asset_link_ticket_create_test' });
  registerCapabilityParticipation('co-managed-seat', ({ tenantIds }) => coManagedSeatParticipants(tenantIds, db));
  process.env.CAPABILITY_CACHE_TTL_MS = '0';
  dbRef.knex = db;

  const admin = await tenantDb(db, '__test_discovery__')
    .unscoped('users as u', 'test discovery of the seeded MSP administrator for asset link on ticket create integration')
    .join('user_roles as ur', function () { this.on('ur.tenant', 'u.tenant').andOn('ur.user_id', 'u.user_id'); })
    .join('roles as r', function () { this.on('r.tenant', 'ur.tenant').andOn('r.role_id', 'ur.role_id'); })
    .where({ 'u.user_type': 'internal', 'r.role_name': 'Admin', 'r.msp': true })
    .select('u.tenant', 'u.user_id')
    .first();
  expect(admin).toBeTruthy();
  dbRef.tenant = admin.tenant;
  mspUser = await principal(admin.user_id);
  fixture = await createCloseRulesFixture(db, admin.tenant, admin.user_id);

  otherClientId = randomUUID();
  const ownClient = await db('clients').where({ tenant: tenant(), client_id: fixture.clientId }).first();
  await db('clients').insert({ ...ownClient, client_id: otherClientId, client_name: `AL other client ${otherClientId.slice(0, 8)}` });

  const now = new Date().toISOString();
  [ownAsset, otherAsset] = [randomUUID(), randomUUID()];
  const asset = (id: string, clientId: string | null, name: string) => ({
    tenant: tenant(), asset_id: id, asset_type: 'workstation', client_id: clientId, asset_tag: `AL-${id.slice(0, 8)}`,
    name, status: 'active', created_at: now, updated_at: now,
  });
  await insertTestAssets(db, [asset(ownAsset, fixture.clientId, 'Own PC'), asset(otherAsset, otherClientId, 'Other PC')]);

  // A seat technician: coarse ticket create and asset update, but the seat baseline closes asset writes at record level.
  await db('co_managed_entitlements').insert({ tenant: tenant(), source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 20,
    verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
  const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant(), clientId: fixture.clientId,
    operationId: randomUUID(), seats: 2 });
  await setCoManagedSeatBoardScope(db, { sponsorTenant: tenant(), arrangementId: arrangement.arrangement_id,
    boards: [{ boardId: fixture.boardId, canCreate: true }] });
  const seatUserId = await createUser('Seat', [['ticket', 'create'], ['ticket', 'read'], ['ticket', 'update'], ['asset', 'read'], ['asset', 'update']]);
  await db.transaction(async (trx) => {
    await retainBuiltinResolverSubject(trx, { tenant: tenant(), userId: seatUserId }, CO_MANAGED_SEAT_RESOLVER_ID);
    await trx('co_managed_seat_assignments').insert({ tenant: tenant(), assignment_id: randomUUID(), arrangement_id: arrangement.arrangement_id,
      user_id: seatUserId, state: 'active' });
  });
  technician = await principal(seatUserId);

  // Plain internal users: one may link assets, one holds no asset:update.
  linker = await principal(await createUser('Linker', [['ticket', 'create'], ['ticket', 'read'], ['asset', 'read'], ['asset', 'update']]));
  noAssetUser = await principal(await createUser('NoAsset', [['ticket', 'create'], ['ticket', 'read'], ['asset', 'read']]));
}, HOOK_TIMEOUT);

afterAll(async () => {
  delete process.env.CAPABILITY_CACHE_TTL_MS;
  await db?.destroy().catch(() => undefined);
});

describe('asset links on ticket create', () => {
  it('1. refuses a seat technician linking another client\'s asset by the singular asset_id, writing nothing', async () => {
    const [tickets, links] = [await ticketCount(), await linkCount()];
    const outcome = await create(technician, { asset_id: otherAsset });
    expect(outcome).toMatchObject({ ok: false });
    expect(await ticketCount()).toBe(tickets);
    expect(await linkCount()).toBe(links);
  }, HOOK_TIMEOUT);

  it('2. links an own-client asset by the singular asset_id for an actor who may update it', async () => {
    const outcome = await create(linker, { asset_id: ownAsset });
    expect(outcome, JSON.stringify(outcome)).toMatchObject({ ok: true });
    const ticketId = (outcome as { ticketId: string }).ticketId;
    expect(await db('asset_associations').where({ tenant: tenant(), asset_id: ownAsset, entity_id: ticketId, entity_type: 'ticket' }).count('* as n').first())
      .toMatchObject({ n: '1' });
  }, HOOK_TIMEOUT);

  it('3. refuses plural asset_ids naming a cross-client asset, even beside an own-client one', async () => {
    const [tickets, links] = [await ticketCount(), await linkCount()];
    const outcome = await create(linker, { asset_ids: JSON.stringify([ownAsset, otherAsset]) });
    expect(outcome).toMatchObject({ ok: false });
    expect((outcome as { message: string }).message).toMatch(/does not belong to the selected client/);
    expect(await ticketCount()).toBe(tickets);
    expect(await linkCount()).toBe(links);
  }, HOOK_TIMEOUT);

  it('4. refuses an actor without asset:update who sends only the singular asset_id', async () => {
    const [tickets, links] = [await ticketCount(), await linkCount()];
    const outcome = await create(noAssetUser, { asset_id: ownAsset });
    expect(outcome).toMatchObject({ ok: false });
    expect((outcome as { message: string }).message).toMatch(/Permission denied/);
    expect(await ticketCount()).toBe(tickets);
    expect(await linkCount()).toBe(links);
  }, HOOK_TIMEOUT);

  it('5. applies the record-level rule: a same-client asset the kernel denies for update is refused despite coarse asset:update', async () => {
    const [tickets, links] = [await ticketCount(), await linkCount()];
    const outcome = await create(technician, { asset_id: ownAsset });
    expect(outcome).toMatchObject({ ok: false });
    expect((outcome as { message: string }).message).toMatch(/Permission denied|Invalid asset: .* was not found/);
    expect((outcome as { message: string }).message).not.toMatch(/does not belong/);
    expect(await ticketCount()).toBe(tickets);
    expect(await linkCount()).toBe(links);
  }, HOOK_TIMEOUT);

  it('6. refuses createTicketFromAsset with client A and an asset of client B, writing nothing', async () => {
    const [tickets, links] = [await ticketCount(), await linkCount()];
    const outcome = await settle(() => as(mspUser, () => createTicketFromAsset({
      title: 'From asset', description: 'x', priority_id: fixture.priorityId, status_id: fixture.openStatusId,
      board_id: fixture.boardId, asset_id: otherAsset, client_id: fixture.clientId,
    })));
    expect(outcome).toMatchObject({ ok: false });
    expect(await ticketCount()).toBe(tickets);
    expect(await linkCount()).toBe(links);

    const ok = await settle(() => as(mspUser, () => createTicketFromAsset({
      title: 'From asset ok', description: 'x', priority_id: fixture.priorityId, status_id: fixture.openStatusId,
      board_id: fixture.boardId, asset_id: ownAsset, client_id: fixture.clientId,
    })));
    expect(ok, JSON.stringify(ok)).toMatchObject({ ok: true });
  }, HOOK_TIMEOUT);

  it('7. refuses a ticket with no client (assets.client_id is NOT NULL in the schema, so a null-client asset cannot exist)', async () => {
    const [tickets, links] = [await ticketCount(), await linkCount()];
    for (const ticketClientId of [null, undefined, '']) {
      await expect(db.transaction((trx) => assertTicketAssetLinksAllowed(trx, tenant(), mspUser, { ticketClientId, assetIds: [ownAsset] })))
        .rejects.toThrow(/does not belong to the selected client/);
    }
    // And the same helper through addTicket's persisted-client path: an asset that is not the ticket's client's.
    const outcome = await create(mspUser, { asset_id: otherAsset });
    expect(outcome).toMatchObject({ ok: false });
    expect(await ticketCount()).toBe(tickets);
    expect(await linkCount()).toBe(links);
  }, HOOK_TIMEOUT);
});
