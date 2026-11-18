/**
 * Co-managed seat and workspace shapes, slice S36 (F088, F089) on real Postgres: seat technicians in user
 * administration.
 *
 *  - The split read puts users with a live seat apart from staff, names their client, and treats a revoked
 *    seat as staff with no label.
 *  - The licence figure is `countLicensedInternalUsers` through `getLicenseUsage`, and adding seat technicians
 *    leaves it where it was (acceptance item 7).
 *  - Effective access is the authorization simulator's decision through the real kernel, seat resolver
 *    included: a ticket on a board outside the arrangement's scope is denied with the board-scope explanation,
 *    and one inside it is allowed. Nothing about permissions is mocked; only the session is injected.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const dbRef = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '' }));
const session = vi.hoisted(() => ({ user: null as any }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
  getConnection: vi.fn(async () => dbRef.knex),
}));
vi.mock('@/lib/db', () => ({ createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })) }));
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  withAuth: (action: any) => (...args: any[]) => action(session.user, { tenant: dbRef.tenant }, ...args),
}));

// What the server registers at boot: the seat authority resolver comes with it.
import '@alga-psa/co-managed/capability';
import {
  createCoManagedSeatArrangement, readCoManagedSeatTechnicianUsers, setCoManagedSeatBoardScope,
} from '@alga-psa/co-managed';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
import { countLicensedInternalUsers } from '@alga-psa/licensing/lib/licensed-internal-users';
import { getLicenseUsage } from '@alga-psa/licensing/lib/get-license-usage';
import { tenantDb } from '@alga-psa/db';
import { createAuthorizationBundle, createBundleAssignment, ensurePublishedBundleRule } from '@alga-psa/authorization/bundles/service';
import { runAuthorizationBundleSimulationAction } from '../../../../ee/server/src/lib/actions/auth/authorizationBundleActions';
import { createCloseRulesFixture, insertTicket, type CloseRulesFixture } from './helpers/closeRulesFixture';

const HOOK_TIMEOUT = 240_000;
const DAY = 86_400_000;

let db: Knex;
let fixture: CloseRulesFixture;
let arrangementId: string;
let mspUser: any;
let roleId: string;
let outOfScopeBoard: { boardId: string; statusId: string };

const tenant = () => fixture.tenantId;

async function principal(userId: string): Promise<any> {
  const user = await db('users').where({ tenant: dbRef.tenant, user_id: userId }).first();
  const roles = await db('user_roles as ur').join('roles as r', function () {
    this.on('r.tenant', 'ur.tenant').andOn('r.role_id', 'ur.role_id');
  }).where({ 'ur.tenant': dbRef.tenant, 'ur.user_id': userId }).select('r.*');
  return { ...user, roles };
}

async function insertInternalUser(label: string): Promise<string> {
  const userId = randomUUID();
  await db('users').insert({ tenant: tenant(), user_id: userId, username: `s36-${label}-${userId.slice(0, 8)}`,
    first_name: 'S36', last_name: label, hashed_password: 'not-used', user_type: 'internal',
    email: `s36-${userId.slice(0, 8)}@example.com` });
  await db('user_roles').insert({ tenant: tenant(), user_id: userId, role_id: roleId });
  return userId;
}

async function seatUser(label: string, state: 'active' | 'revoked' = 'active'): Promise<string> {
  const userId = await insertInternalUser(label);
  await db.transaction(async (trx) => {
    await retainBuiltinResolverSubject(trx, { tenant: tenant(), userId }, CO_MANAGED_SEAT_RESOLVER_ID);
    await trx('co_managed_seat_assignments').insert({ tenant: tenant(), assignment_id: randomUUID(), arrangement_id: arrangementId,
      user_id: userId, state, ...(state === 'revoked' ? { revoked_at: new Date() } : {}) });
  });
  return userId;
}

const simulate = async (userId: string, ticketId: string) => {
  session.user = mspUser;
  try {
    return await runAuthorizationBundleSimulationAction({ principalUserId: userId, resourceType: 'ticket', action: 'read', resourceId: ticketId });
  } finally { session.user = null; }
};

beforeAll(async () => {
  db = await createTestDbConnection({ databaseName: 's36_seat_technicians_user_admin_test' });
  dbRef.knex = db;
  const admin = await tenantDb(db, '__test_discovery__')
    .unscoped('users as u', 'test discovery of the seeded MSP administrator for seat technician user administration')
    .join('user_roles as ur', function () { this.on('ur.tenant', 'u.tenant').andOn('ur.user_id', 'u.user_id'); })
    .join('roles as r', function () { this.on('r.tenant', 'ur.tenant').andOn('r.role_id', 'ur.role_id'); })
    .where({ 'u.user_type': 'internal', 'r.role_name': 'Admin', 'r.msp': true })
    .select('u.tenant', 'u.user_id').first();
  expect(admin).toBeTruthy();
  dbRef.tenant = admin.tenant;
  mspUser = await principal(admin.user_id);
  fixture = await createCloseRulesFixture(db, admin.tenant, admin.user_id);

  const boardId = randomUUID();
  const statusId = randomUUID();
  await db('boards').insert({ tenant: tenant(), board_id: boardId, board_name: `S36 MSP only ${boardId.slice(0, 8)}`,
    is_default: false, is_inactive: false, display_order: 999 });
  await db('statuses').insert({ tenant: tenant(), status_id: statusId, board_id: boardId, name: 'Open', status_type: 'ticket',
    is_closed: false, is_default: true, order_number: 10, created_by: fixture.userId });
  outOfScopeBoard = { boardId, statusId };

  await db('co_managed_entitlements').insert({ tenant: tenant(), source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 20,
    verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
  arrangementId = (await createCoManagedSeatArrangement(db, { sponsorTenant: tenant(), clientId: fixture.clientId,
    operationId: randomUUID(), seats: 5 })).arrangement_id;
  await setCoManagedSeatBoardScope(db, { sponsorTenant: tenant(), arrangementId, boards: [{ boardId: fixture.boardId, canCreate: true }] });

  // A role that grants ticket:read and nothing else.
  const ticketRead = await db('permissions').where({ tenant: tenant(), resource: 'ticket', action: 'read', msp: true }).first();
  expect(ticketRead).toBeTruthy();
  roleId = randomUUID();
  await db('roles').insert({ tenant: tenant(), role_id: roleId, role_name: `S36 seat read only ${roleId.slice(0, 8)}`, msp: true, client: false });
  await db('role_permissions').insert({ tenant: tenant(), role_id: roleId, permission_id: ticketRead.permission_id });
}, HOOK_TIMEOUT);

afterAll(async () => { await db?.destroy().catch(() => undefined); });

describe('seat technicians apart from staff, with the licence figure unchanged (F088)', () => {
  it('splits users with a live seat from staff, names their client, and treats a revoked seat as staff', async () => {
    const staff = await insertInternalUser('staff');
    const active = await seatUser('active');
    const revoked = await seatUser('revoked', 'revoked');

    const technicians = await readCoManagedSeatTechnicianUsers(db, { sponsorTenant: tenant() });
    const byUser = new Map(technicians.map((row) => [row.userId, row]));
    const clientName = (await db('clients').where({ tenant: tenant(), client_id: fixture.clientId }).first()).client_name;

    expect(byUser.get(active)).toMatchObject({ arrangementId, clientId: fixture.clientId, clientName, state: 'active' });
    expect(byUser.has(staff)).toBe(false);
    expect(byUser.has(revoked)).toBe(false);
  }, HOOK_TIMEOUT);

  it('the licence figure is the shared rule, and seat technicians do not move it', async () => {
    const before = await getLicenseUsage(tenant(), db as any);
    expect(before.used).toBe(await countLicensedInternalUsers(db, tenant()));

    await seatUser('licence-a');
    await seatUser('licence-b');
    const after = await getLicenseUsage(tenant(), db as any);

    expect(after.used).toBe(before.used);
    expect(after.used).toBe(await countLicensedInternalUsers(db, tenant()));
    // The users exist: the figure is lower than a count of every internal user, which is what a client-side count would give.
    const everyone = Number((await db('users').where({ tenant: tenant(), user_type: 'internal', is_inactive: false }).count('* as n').first())!.n);
    expect(after.used).toBeLessThan(everyone);
  }, HOOK_TIMEOUT);
});

describe('effective access of a seat technician, from the authorization simulator (F089)', () => {
  it('a ticket inside the arrangement\'s board scope is allowed', async () => {
    const userId = await seatUser('in-scope');
    const ticketId = await insertTicket(db, fixture);
    const result = await simulate(userId, ticketId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.published).toMatchObject({ allowed: true, explanations: [] });
  }, HOOK_TIMEOUT);

  it('a ticket on a board outside the scope is denied, and the reason is the board scope', async () => {
    const userId = await seatUser('out-of-scope');
    const ticketId = await insertTicket(db, fixture);
    await db('tickets').where({ tenant: tenant(), ticket_id: ticketId }).update({ board_id: outOfScopeBoard.boardId, status_id: outOfScopeBoard.statusId });
    const result = await simulate(userId, ticketId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.published.allowed).toBe(false);
    expect(result.data.published.reasonCodes).toContain('builtin:resolver_template_denied');
    expect(result.data.published.explanations).toContainEqual(expect.objectContaining({
      kind: 'resolver_board_scope', messageKey: 'policyManagement.simulator.explanations.resolverBoardScope',
    }));
  }, HOOK_TIMEOUT);

  it('staff are decided without the seat resolver: the same out-of-scope ticket is readable by the administrator', async () => {
    const ticketId = await insertTicket(db, fixture);
    await db('tickets').where({ tenant: tenant(), ticket_id: ticketId }).update({ board_id: outOfScopeBoard.boardId, status_id: outOfScopeBoard.statusId });
    const result = await simulate(mspUser.user_id, ticketId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.published.allowed).toBe(true);
  }, HOOK_TIMEOUT);
  describe('with an assigned narrowing bundle, the answer is the product\'s', () => {
    /** A published bundle that limits ticket reads to a board the arrangement does not share. */
    async function narrowingBundle(): Promise<string> {
      const { bundleId } = await createAuthorizationBundle(db, { tenant: tenant(), name: `S36 narrowing ${randomUUID().slice(0, 8)}`, actorUserId: fixture.userId });
      await ensurePublishedBundleRule(db, { tenant: tenant(), bundleId, resourceType: 'ticket', action: 'read',
        templateKey: 'selected_boards', config: { selectedBoardIds: [outOfScopeBoard.boardId] }, actorUserId: fixture.userId });
      return bundleId;
    }

    it('a bundle assigned to the technician denies an in-scope ticket the seat resolver alone would allow, and says so', async () => {
      const userId = await seatUser('bundle-user');
      const ticketId = await insertTicket(db, fixture);
      const allowedBefore = await simulate(userId, ticketId);
      expect(allowedBefore.ok && allowedBefore.data.published.allowed).toBe(true);

      await createBundleAssignment(db, { tenant: tenant(), bundleId: await narrowingBundle(), targetType: 'user', targetId: userId });
      const result = await simulate(userId, ticketId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const side of [result.data.draft, result.data.published]) {
        expect(side.allowed).toBe(false);
        expect(side.reasonCodes).toContain('bundle:bundle_template_denied');
        expect(side.explanations).toContainEqual(expect.objectContaining({ code: 'bundle_template_denied' }));
      }
    }, HOOK_TIMEOUT);

    it('a bundle assigned through the technician\'s role applies the same way', async () => {
      const userId = await seatUser('bundle-role');
      const ticketId = await insertTicket(db, fixture);
      const ownRole = randomUUID();
      const ticketRead = await db('permissions').where({ tenant: tenant(), resource: 'ticket', action: 'read', msp: true }).first();
      await db('roles').insert({ tenant: tenant(), role_id: ownRole, role_name: `S36 own role ${ownRole.slice(0, 8)}`, msp: true, client: false });
      await db('role_permissions').insert({ tenant: tenant(), role_id: ownRole, permission_id: ticketRead.permission_id });
      await db('user_roles').insert({ tenant: tenant(), user_id: userId, role_id: ownRole });
      await createBundleAssignment(db, { tenant: tenant(), bundleId: await narrowingBundle(), targetType: 'role', targetId: ownRole });
      const result = await simulate(userId, ticketId);
      expect(result.ok && result.data.published.allowed).toBe(false);
      expect(result.ok && result.data.published.reasonCodes).toContain('bundle:bundle_template_denied');
    }, HOOK_TIMEOUT);
  });
});
