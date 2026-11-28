/**
 * Protect the co-managed Seat Technician role (plan pl-f68bfdf9, alga-2026-0003429): T001 and T002
 * on real Postgres.
 *
 * Alga alone controls the seat role. An authorized administrator's ordinary and bulk role writers
 * are refused for its definition, grants and membership while ordinary custom roles keep working;
 * only the seat lifecycle (acceptance, revocation, conversion) changes who holds it.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({ tenant: '', userId: '' }));

// The actions' own authorization: the acting administrator holds every permission.
vi.mock('../../../../packages/auth/src/lib/withAuth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action({ user_id: testState.userId, tenant: testState.tenant, user_type: 'internal' }, { tenant: testState.tenant }, ...args),
}));
vi.mock('../../../../packages/auth/src/lib/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return { ...actual, createTenantKnex: async () => ({ knex: (globalThis as any).__seatRoleTestDb, tenant: testState.tenant }) };
});
vi.mock('@enterprise/lib/license/userSeatGuard', () => ({ checkApplianceLicenseSeatLimit: async () => null }));

import {
  acceptCoManagedSeatInvitation, convertCoManagedSeatTechnicianToMspUser, createCoManagedSeatArrangement,
  inviteCoManagedSeatTechnician, CO_MANAGED_SEAT_ROLE, CO_MANAGED_SEAT_ROLE_GRANTS, revokeCoManagedSeatAssignment, setCoManagedSeatBoardScope,
} from '@alga-psa/co-managed';
import { CO_MANAGED_SEAT_RESOLVER_ID, coManagedSeatResolver } from '@alga-psa/co-managed/seatAuthority';
import {
  BuiltinAuthorizationKernelProvider, RequestLocalAuthorizationCache, createAuthorizationKernel, registerBuiltinRuleResolver,
} from '@alga-psa/authorization/kernel';
import { resolveAuthorizationSubject } from '@alga-psa/authorization/subject';
import { runAsTenantTeardown, runWithTenant, tenantDb } from '@alga-psa/db';
import User from '@alga-psa/db/models/user';
import { PermissionRoleService } from '../../lib/api/services/PermissionRoleService';
import {
  assignPermissionToRole, assignRoleToUser, createRole, deleteRole, removePermissionFromRole, removeRoleFromUser, updateRole,
} from '../../../../packages/auth/src/actions/policyActions';
import { mspSeatAdmissionForConversion } from '../../../../packages/users/src/lib/internalUserLicenseGuard';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createContact, createTenant, createUser } from '../../../test-utils/testDataFactory';

const require = createRequire(import.meta.url);
const permissionsDir = path.resolve(__dirname, '../../../migrations/utils/permissions');
const { syncPermissionCatalog } = require(path.join(permissionsDir, 'syncPermissionCatalog.cjs'));
const { getDefaultRoles } = require(path.join(permissionsDir, 'roleGrants.cjs'));

const DAY = 86_400_000;
const PASSWORD = 'Correct-horse-9-battery';
const describeDb = await describeWithDb();

describeDb('the seat role belongs to Alga (T001, T002)', { shuffle: false }, () => {
  let db: Knex;

  const sponsorWithSeat = async () => {
    const sponsor = await createTenant(db, `Owned role sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('roles').insert(getDefaultRoles('psa').filter((role: any) => !role.legacy).map((role: any) => ({
      tenant: sponsor, role_id: randomUUID(), role_name: role.roleName, msp: role.msp, client: role.client,
    })));
    await syncPermissionCatalog(db, sponsor, 'psa');
    await db('co_managed_entitlements').insert({ tenant: sponsor, source: 'hosted', source_reference: `sub_${randomUUID()}`,
      capacity: 10, verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    const clientId = await createClient(db, sponsor, `Seat client ${randomUUID().slice(0, 8)}`);
    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: sponsor, clientId, operationId: randomUUID(), seats: 3 });
    const admin = await createUser(db, sponsor, { user_type: 'internal' });
    const adminRole = (await db('roles').where({ tenant: sponsor, role_name: 'Admin', msp: true }).first()).role_id;
    await db('user_roles').insert({ tenant: sponsor, user_id: admin, role_id: adminRole });
    const seatRole = await db('roles').where({ tenant: sponsor, managed_by: 'co-managed-seat' }).first();
    testState.tenant = sponsor;
    testState.userId = admin;
    return { sponsor, clientId, arrangementId: arrangement.arrangement_id, admin, adminRole, seatRole };
  };
  const technician = async (sponsor: string, arrangementId: string, clientId: string) => {
    const contactId = await createContact(db, sponsor, clientId, { fullName: 'Dana Reyes', email: `tech.${randomUUID().slice(0, 12)}@client.example` });
    const invitation = await inviteCoManagedSeatTechnician(db, { sponsorTenant: sponsor, arrangementId, contactId });
    return { ...(await acceptCoManagedSeatInvitation(db, { token: invitation.token, password: PASSWORD })), invitation };
  };
  const snapshot = async (tenant: string, roleId: string) => ({
    role: await db('roles').where({ tenant, role_id: roleId }).first(),
    grants: (await db('role_permissions').where({ tenant, role_id: roleId }).pluck('permission_id')).sort(),
    members: (await db('user_roles').where({ tenant, role_id: roleId }).pluck('user_id')).sort(),
  });
  const refusal = async (work: () => Promise<unknown>) => {
    const outcome: any = await work().then((value) => value, (error) => error);
    return outcome;
  };
  const expectRefused = async (work: () => Promise<unknown>, code: string) => {
    const outcome = await refusal(work);
    expect(outcome, 'refused').toMatchObject({ name: 'ManagedRoleOwnershipError', code });
  };
  const serviceFor = (tenant: string) => {
    const service = new PermissionRoleService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant });
    return service;
  };

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 'managed_seat_role_ownership_3429' });
    (globalThis as any).__seatRoleTestDb = db;
    registerBuiltinRuleResolver(coManagedSeatResolver);
  }, 300_000);
  afterAll(async () => { await db?.destroy(); });

  // F001
  it('gives the seat role a stable identity of its own, one per tenant, and reserves it', async () => {
    const { sponsor, seatRole } = await sponsorWithSeat();
    expect(seatRole).toMatchObject({ role_name: 'Seat Technician', msp: true, client: false, managed_by: 'co-managed-seat' });
    // One role per (tenant, owner): the index is the backstop.
    await expect(db('roles').insert({ tenant: sponsor, role_id: randomUUID(), role_name: 'Another', managed_by: 'co-managed-seat' })).rejects.toThrow();
    // The grants are exactly the catalog's.
    const grants = await db('role_permissions as rp').join('permissions as p', function () {
      this.on('p.tenant', 'rp.tenant').andOn('p.permission_id', 'rp.permission_id');
    }).where({ 'rp.tenant': sponsor, 'rp.role_id': seatRole.role_id }).select('p.resource', 'p.action');
    expect(grants.map((g: any) => `${g.resource}:${g.action}`).sort()).toEqual([...CO_MANAGED_SEAT_ROLE_GRANTS].sort());
  }, 120_000);

  // T001 / F001, F002
  it('refuses every ordinary and bulk writer against the managed role definition and grants, and serves custom roles', async () => {
    const { sponsor, admin, seatRole } = await sponsorWithSeat();
    const roles = serviceFor(sponsor);
    const context = { tenant: sponsor, userId: admin } as any;
    const before = await snapshot(sponsor, seatRole.role_id);
    const userRead = (await db('permissions').where({ tenant: sponsor, resource: 'user', action: 'read', msp: true }).first()).permission_id;
    const ticketRead = (await db('permissions').where({ tenant: sponsor, resource: 'ticket', action: 'read', msp: true }).first()).permission_id;

    // REST: definition.
    await expectRefused(() => roles.updateRole(seatRole.role_id, { role_name: 'Renamed' } as any, context), 'MANAGED_ROLE_DEFINITION');
    await expectRefused(() => roles.updateRole(seatRole.role_id, { description: 'Edited' } as any, context), 'MANAGED_ROLE_DEFINITION');
    await expectRefused(() => roles.deleteRole(seatRole.role_id, context), 'MANAGED_ROLE_GRANTS');
    // REST: grants add, remove and replace.
    await expectRefused(() => roles.assignPermissionsToRole(seatRole.role_id, [userRead], context), 'MANAGED_ROLE_GRANTS');
    await expectRefused(() => roles.removePermissionsFromRole(seatRole.role_id, [ticketRead], context), 'MANAGED_ROLE_GRANTS');
    await expectRefused(() => roles.replaceRolePermissions(seatRole.role_id, [userRead], context), 'MANAGED_ROLE_GRANTS');
    // REST: bulk.
    await expectRefused(() => roles.bulkUpdateRoles({ updates: [{ role_id: seatRole.role_id, data: { description: 'x' } }] } as any, context), 'MANAGED_ROLE_DEFINITION');
    await expectRefused(() => roles.bulkDeleteRoles({ role_ids: [seatRole.role_id] } as any, context), 'MANAGED_ROLE_GRANTS');
    // Identity is reserved: create, bulk create, clone and rename cannot collide with it.
    // The exact name is a plain duplicate; a variant the duplicate check misses meets the reservation.
    await expect(roles.createRole({ role_name: 'Seat Technician', description: 'x', msp: true, client: false } as any, context)).rejects.toThrow();
    await expectRefused(() => roles.createRole({ role_name: 'seat technician', description: 'x', msp: true, client: false } as any, context), 'MANAGED_ROLE_IDENTITY_RESERVED');
    await expectRefused(() => roles.bulkCreateRoles({ roles: [{ role_name: 'SEAT TECHNICIAN', description: 'x', msp: true, client: false }] } as any, context), 'MANAGED_ROLE_IDENTITY_RESERVED');
    expect(await db('roles').where({ tenant: sponsor }).whereRaw('lower(role_name) = ?', ['seat technician']).count('* as count').first()).toMatchObject({ count: '1' });

    // Server actions.
    for (const [work, code] of [
      [() => updateRole(seatRole.role_id, { role_name: 'Renamed' }), 'definition'],
      [() => assignPermissionToRole(seatRole.role_id, userRead), 'grants'],
      [() => removePermissionFromRole(seatRole.role_id, ticketRead), 'grants'],
    ] as const) {
      expect(await work(), code).toMatchObject({ actionError: expect.stringContaining('managed'), messageKey: 'msp/settings:errors.roles.managedRole' });
    }
    expect(await deleteRole(seatRole.role_id)).toMatchObject({ success: false, canDelete: false });
    expect(await createRole('seat technician', 'copy', true, false)).toMatchObject({ messageKey: 'msp/settings:errors.roles.managedRole' });

    // Identity, grants and members are what they were.
    expect(await snapshot(sponsor, seatRole.role_id)).toEqual(before);

    // Ordinary custom roles keep working through the same writers.
    const custom = await roles.createRole({ role_name: 'Dispatch lead', description: 'Custom', msp: true, client: false } as any, context);
    await roles.updateRole(custom.role_id, { description: 'Edited custom' } as any, context);
    await roles.assignPermissionsToRole(custom.role_id, [userRead, ticketRead], context);
    await roles.removePermissionsFromRole(custom.role_id, [userRead], context);
    await roles.replaceRolePermissions(custom.role_id, [ticketRead], context);
    await roles.bulkUpdateRoles({ updates: [{ role_id: custom.role_id, data: { description: 'Bulk edited' } }] } as any, context);
    expect(await db('role_permissions').where({ tenant: sponsor, role_id: custom.role_id }).pluck('permission_id')).toEqual([ticketRead]);
    expect(await updateRole(custom.role_id, { description: 'By action' })).toMatchObject({ description: 'By action' });
    // A custom role cannot be renamed into the reserved identity.
    await expectRefused(() => roles.updateRole(custom.role_id, { role_name: 'seat technician' } as any, context), 'MANAGED_ROLE_IDENTITY_RESERVED');
    // The action's own duplicate check answers first; the guard is the backstop behind it.
    expect(await updateRole(custom.role_id, { role_name: 'Seat Technician' })).toHaveProperty('actionError');
    await roles.bulkDeleteRoles({ role_ids: [custom.role_id] } as any, context);
    expect(await db('roles').where({ tenant: sponsor, role_id: custom.role_id }).first()).toBeUndefined();
    const another = await createRole('Another custom', 'Custom', true, false) as any;
    expect(another.role_id).toBeTruthy();
    expect(await deleteRole(another.role_id)).toMatchObject({ success: true });
  }, 120_000);

  // T001 / F003
  it('refuses manual assignment, replacement and removal of the seat role, and a manual assignment never creates a seat', async () => {
    const { sponsor, clientId, arrangementId, admin, adminRole, seatRole } = await sponsorWithSeat();
    const roles = serviceFor(sponsor);
    const context = { tenant: sponsor, userId: admin } as any;
    const tech = await technician(sponsor, arrangementId, clientId);
    const ordinary = await createUser(db, sponsor, { user_type: 'internal' });
    await db('user_roles').insert({ tenant: sponsor, user_id: ordinary, role_id: adminRole });
    const before = await snapshot(sponsor, seatRole.role_id);
    const seats = async () => Number((await db('co_managed_seat_assignments').where({ tenant: sponsor }).whereNot('state', 'revoked').count('* as count').first())?.count);
    const seatsBefore = await seats();

    // The technician is a member through the lifecycle.
    expect(before.members).toEqual([tech.user_id]);
    // Assignment to an ordinary user: REST, actions, the shared model.
    await expectRefused(() => roles.assignRolesToUser(ordinary, [seatRole.role_id], context), 'MANAGED_ROLE_MEMBERSHIP');
    await expectRefused(() => roles.replaceUserRoles(ordinary, [adminRole, seatRole.role_id], context), 'MANAGED_ROLE_MEMBERSHIP');
    expect(await assignRoleToUser(ordinary, seatRole.role_id)).toMatchObject({ messageKey: 'msp/settings:errors.roles.managedRole' });
    await expectRefused(() => runWithTenant(sponsor, () => db.transaction((trx) =>
      User.updateUserRoles(trx, ordinary, [{ role_id: seatRole.role_id } as any, { role_id: adminRole } as any]))), 'MANAGED_ROLE_MEMBERSHIP');
    // The technician's only role cannot be removed (the role floor answers first)...
    await expect(roles.removeRolesFromUser(tech.user_id, [seatRole.role_id], context)).rejects.toThrow();
    // ...and a holder from before ownership, who has another role, cannot lose the seat role by hand either.
    const legacy = await createUser(db, sponsor, { user_type: 'internal' });
    await db('user_roles').insert([{ tenant: sponsor, user_id: legacy, role_id: adminRole }, { tenant: sponsor, user_id: legacy, role_id: seatRole.role_id }]);
    const withLegacy = await snapshot(sponsor, seatRole.role_id);
    await expectRefused(() => roles.removeRolesFromUser(legacy, [seatRole.role_id], context), 'MANAGED_ROLE_MEMBERSHIP');
    await expectRefused(() => roles.replaceUserRoles(legacy, [adminRole], context), 'MANAGED_ROLE_MEMBERSHIP');
    expect(await removeRoleFromUser(legacy, seatRole.role_id)).toMatchObject({ messageKey: 'msp/settings:errors.roles.managedRole' });
    expect(await snapshot(sponsor, seatRole.role_id)).toEqual(withLegacy);
    await db('user_roles').where({ tenant: sponsor, user_id: legacy, role_id: seatRole.role_id }).del();

    expect(await snapshot(sponsor, seatRole.role_id)).toEqual(before);
    expect(await db('user_roles').where({ tenant: sponsor, user_id: ordinary }).pluck('role_id')).toEqual([adminRole]);
    // No manual assignment made a seat.
    expect(await seats()).toBe(seatsBefore);
    expect(await db('co_managed_seat_assignments').where({ tenant: sponsor, user_id: ordinary }).first()).toBeUndefined();
  }, 120_000);

  // T002
  it('runs the seat lifecycle through the guard: acceptance, scoped ticket access, revocation and conversion', async () => {
    const { sponsor, clientId, arrangementId, seatRole, adminRole } = await sponsorWithSeat();
    const allowedBoard = randomUUID();
    const excludedBoard = randomUUID();
    for (const boardId of [allowedBoard, excludedBoard]) {
      await db('boards').insert({ tenant: sponsor, board_id: boardId, board_name: `Board ${boardId.slice(0, 8)}`, is_default: false });
    }
    await setCoManagedSeatBoardScope(db, { sponsorTenant: sponsor, arrangementId, boards: [{ boardId: allowedBoard, canCreate: true }] });

    // Acceptance gives the seat role and nothing else.
    const tech = await technician(sponsor, arrangementId, clientId);
    expect(await db('user_roles').where({ tenant: sponsor, user_id: tech.user_id }).pluck('role_id')).toEqual([seatRole.role_id]);

    // Ticket access follows the arrangement: the allowed board yes, the excluded board no.
    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider({ relationshipRules: [] }), rbacEvaluator: async () => true,
    });
    const decide = async (boardId: string) => {
      const subject = await resolveAuthorizationSubject(db, {
        tenant: sponsor, user: { user_id: tech.user_id, user_type: 'internal' }, requestCache: new RequestLocalAuthorizationCache(),
      });
      return (await kernel.authorizeResource({ subject, resource: { type: 'ticket', action: 'read' }, record: { id: randomUUID(), clientId, boardId } })).allowed;
    };
    expect(await decide(allowedBoard)).toBe(true);
    expect(await decide(excludedBoard)).toBe(false);

    // Revocation takes the role with the seat.
    const revoked = await revokeCoManagedSeatAssignment(db, { sponsorTenant: sponsor, assignmentId: tech.assignment_id });
    expect(revoked.revoked).toBe(true);
    expect(await db('user_roles').where({ tenant: sponsor, user_id: tech.user_id }).pluck('role_id')).toEqual([]);

    // Conversion replaces the seat role with MSP roles, and the seat role is never a conversion target.
    const second = await technician(sponsor, arrangementId, clientId);
    await expect(convertCoManagedSeatTechnicianToMspUser(db, {
      sponsorTenant: sponsor, assignmentId: second.assignment_id, roleIds: [seatRole.role_id],
      seatAdmission: mspSeatAdmissionForConversion,
    } as any)).rejects.toMatchObject({ code: 'ROLE_NOT_ALLOWED' });
    const technicianRole = (await db('roles').where({ tenant: sponsor, role_name: 'Technician', msp: true }).first()).role_id;
    await convertCoManagedSeatTechnicianToMspUser(db, {
      sponsorTenant: sponsor, assignmentId: second.assignment_id, roleIds: [technicianRole],
      seatAdmission: mspSeatAdmissionForConversion,
    } as any);
    expect(await db('user_roles').where({ tenant: sponsor, user_id: second.user_id }).pluck('role_id')).toEqual([technicianRole]);
    expect(await db('user_roles').where({ tenant: sponsor, role_id: seatRole.role_id }).pluck('user_id')).toEqual([]);
    expect(adminRole).toBeTruthy();

    // A second acceptance still finds the one role, and re-asserts its grants.
    const extra = (await db('permissions').where({ tenant: sponsor, resource: 'user', action: 'read', msp: true }).first()).permission_id;
    await db('role_permissions').insert({ tenant: sponsor, role_id: seatRole.role_id, permission_id: extra });
    await technician(sponsor, arrangementId, clientId);
    expect(await db('roles').where({ tenant: sponsor, managed_by: 'co-managed-seat' }).count('* as count').first()).toMatchObject({ count: '1' });
    expect(await db('role_permissions').where({ tenant: sponsor, role_id: seatRole.role_id, permission_id: extra }).first()).toBeUndefined();
    expect(CO_MANAGED_SEAT_ROLE.role_name).toBe('Seat Technician');
    expect(CO_MANAGED_SEAT_RESOLVER_ID).toBeTruthy();
  }, 180_000);

  // T002 (teardown): the guard still refuses every write outside the owner's lifecycle.
  it('refuses a seat-role write through tenantDb outside any scope, and inside a teardown scope for anything but deleting this tenant', async () => {
    const { sponsor, seatRole, admin } = await sponsorWithSeat();
    const other = await createTenant(db, `Other tenant ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    const grant = (await db('role_permissions').where({ tenant: sponsor, role_id: seatRole.role_id }).first()).permission_id;
    const before = await snapshot(sponsor, seatRole.role_id);
    const scoped = tenantDb(db, sponsor);

    await expectRefused(() => scoped.table('roles').where({ role_id: seatRole.role_id }).update({ description: 'x' }), 'MANAGED_ROLE_DEFINITION');
    await expectRefused(() => scoped.table('roles').where({ role_id: seatRole.role_id }).delete(), 'MANAGED_ROLE_DEFINITION');
    await expectRefused(() => scoped.table('role_permissions').where({ role_id: seatRole.role_id, permission_id: grant }).delete(), 'MANAGED_ROLE_GRANTS');
    await expectRefused(() => scoped.table('user_roles').insert({ tenant: sponsor, user_id: admin, role_id: seatRole.role_id }), 'MANAGED_ROLE_MEMBERSHIP');

    // Inside the teardown scope of this tenant: only deletes are admitted.
    await runAsTenantTeardown(sponsor, async () => {
      await expectRefused(() => scoped.table('roles').where({ role_id: seatRole.role_id }).update({ description: 'x' }), 'MANAGED_ROLE_DEFINITION');
      await expectRefused(() => scoped.table('roles').where({ role_id: seatRole.role_id }).update({ managed_by: null }), 'MANAGED_ROLE_DEFINITION');
      await expectRefused(() => scoped.table('roles').insert({ tenant: sponsor, role_id: randomUUID(), role_name: 'Seat Technician', msp: true, client: false }), 'MANAGED_ROLE_IDENTITY_RESERVED');
      await expectRefused(() => scoped.table('roles').insert({ tenant: sponsor, role_id: randomUUID(), role_name: 'Mine', managed_by: 'co-managed-seat' }), 'MANAGED_ROLE_DEFINITION');
      await expectRefused(() => scoped.table('role_permissions').insert({ tenant: sponsor, role_id: seatRole.role_id, permission_id: randomUUID() }), 'MANAGED_ROLE_GRANTS');
      await expectRefused(() => scoped.table('user_roles').insert({ tenant: sponsor, user_id: admin, role_id: seatRole.role_id }), 'MANAGED_ROLE_MEMBERSHIP');
    });
    // The scope names one tenant: a delete against another tenant's managed role is checked normally.
    await db('roles').insert({ tenant: other, role_id: randomUUID(), role_name: 'Seat Technician', msp: true, client: false, managed_by: 'co-managed-seat' });
    await runAsTenantTeardown(sponsor, async () => {
      await expectRefused(() => tenantDb(db, other).table('roles').where({ managed_by: 'co-managed-seat' }).delete(), 'MANAGED_ROLE_DEFINITION');
    });
    expect(await db('roles').where({ tenant: other, managed_by: 'co-managed-seat' }).count('* as count').first()).toMatchObject({ count: '1' });
    expect(await snapshot(sponsor, seatRole.role_id)).toEqual(before);
  }, 120_000);

  // T003 (admission): no seat history means a hand-made look-alike is an unrelated custom role.
  it('leaves a hand-made Seat Technician role in a tenant with no seat history alone and creates a separate managed role', async () => {
    const sponsor = await createTenant(db, `Handmade sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('roles').insert(getDefaultRoles('psa').filter((role: any) => !role.legacy).map((role: any) => ({
      tenant: sponsor, role_id: randomUUID(), role_name: role.roleName, msp: role.msp, client: role.client,
    })));
    await syncPermissionCatalog(db, sponsor, 'psa');
    const handmade = randomUUID();
    await db('roles').insert({ tenant: sponsor, role_id: handmade, role_name: 'Seat Technician', msp: true, client: false, description: 'mine' });
    const billing = (await db('permissions').where({ tenant: sponsor, resource: 'billing', action: 'read', msp: true }).first()).permission_id;
    await db('role_permissions').insert({ tenant: sponsor, role_id: handmade, permission_id: billing });
    const before = await snapshot(sponsor, handmade);

    await db('co_managed_entitlements').insert({ tenant: sponsor, source: 'hosted', source_reference: `sub_${randomUUID()}`,
      capacity: 10, verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    const clientId = await createClient(db, sponsor, `Seat client ${randomUUID().slice(0, 8)}`);
    await createCoManagedSeatArrangement(db, { sponsorTenant: sponsor, clientId, operationId: randomUUID(), seats: 1 });

    // Untouched: same name, description, grants, no owner.
    expect(await snapshot(sponsor, handmade)).toEqual(before);
    expect(before.role).toMatchObject({ role_name: 'Seat Technician', description: 'mine', managed_by: null });
    // A separate managed role, with exactly the catalog grants and a name that does not collide.
    const managed = await db('roles').where({ tenant: sponsor, managed_by: 'co-managed-seat' });
    expect(managed).toHaveLength(1);
    expect(managed[0].role_id).not.toBe(handmade);
    expect(managed[0].role_name).not.toBe('Seat Technician');
    const grants = await db('role_permissions as rp').join('permissions as p', function () {
      this.on('p.tenant', 'rp.tenant').andOn('p.permission_id', 'rp.permission_id');
    }).where({ 'rp.tenant': sponsor, 'rp.role_id': managed[0].role_id }).select('p.resource', 'p.action');
    expect(grants.map((g: any) => `${g.resource}:${g.action}`).sort()).toEqual([...CO_MANAGED_SEAT_ROLE_GRANTS].sort());

    // The legacy role stays an ordinary, editable role: an unchanged identity is not a claim.
    const roles = serviceFor(sponsor);
    const context = { tenant: sponsor, userId: testState.userId } as any;
    await roles.updateRole(handmade, { role_name: 'Seat Technician', description: 'edited' } as any, context);
    expect(await db('roles').where({ tenant: sponsor, role_id: handmade }).first()).toMatchObject({ role_name: 'Seat Technician', description: 'edited' });
    await roles.updateRole(handmade, { role_name: '  seat TECHNICIAN ', description: 'edited again' } as any, context);
    expect(await db('roles').where({ tenant: sponsor, role_id: handmade }).first()).toMatchObject({ description: 'edited again' });
    // Another role still cannot be renamed into the identity, and the managed role stays locked.
    const other = await roles.createRole({ role_name: 'Dispatch lead', description: 'Custom', msp: true, client: false } as any, context);
    await expectRefused(() => roles.updateRole(other.role_id, { role_name: 'Seat Technician' } as any, context), 'MANAGED_ROLE_IDENTITY_RESERVED');
    await expectRefused(() => roles.updateRole(managed[0].role_id, { description: 'Edited' } as any, context), 'MANAGED_ROLE_DEFINITION');
    // The Roles edit dialog's action sends the same payload and succeeds.
    testState.tenant = sponsor;
    expect(await updateRole(handmade, { role_name: 'Seat Technician', description: 'by action' })).toMatchObject({ description: 'by action' });
  }, 120_000);
});
