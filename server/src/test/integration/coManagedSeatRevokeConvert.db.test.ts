/**
 * Co-managed seat and workspace shapes, slice S10 (F022, F023, F024 / T013) on real Postgres.
 *
 * Revoking a seat frees it, deactivates the technician and ends their sessions; converting a
 * technician to an MSP user is admitted against the MSP's own seat limit; and while an assignment
 * is live the technician holds only the seat role and joins no MSP team, through every writer.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  acceptCoManagedSeatInvitation, CoManagedSeatEndError, CoManagedSeatInvitationError, convertCoManagedSeatTechnicianToMspUser,
  createCoManagedSeatArrangement, inviteCoManagedSeatTechnician, CO_MANAGED_SEAT_ROLE, revokeCoManagedSeatAssignment,
} from '@alga-psa/co-managed';
import { countLicensedInternalUsers } from '@alga-psa/licensing';
import {
  assertSeatTechnicianWrite, CO_MANAGED_SEAT_ROLE_NAME, isSeatTechnicianGuardError, runWithTenant, SeatTechnicianGuardError,
} from '@alga-psa/db';
import User from '@alga-psa/db/models/user';
import Team from '../../../../packages/teams/src/models/team';
import { PermissionRoleService } from '../../lib/api/services/PermissionRoleService';
import { TeamService } from '../../lib/api/services/TeamService';
import {
  admitInternalUserSeat, mspSeatAdmissionForConversion,
} from '../../../../packages/users/src/lib/internalUserLicenseGuard';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const require = createRequire(import.meta.url);
const permissionsDir = path.resolve(__dirname, '../../../migrations/utils/permissions');
const { syncPermissionCatalog } = require(path.join(permissionsDir, 'syncPermissionCatalog.cjs'));
const { getDefaultRoles } = require(path.join(permissionsDir, 'roleGrants.cjs'));

// The EE appliance seat check has no licence in a test database.
vi.mock('@enterprise/lib/license/userSeatGuard', () => ({ checkApplianceLicenseSeatLimit: async () => null }));

const DAY = 86_400_000;
const PASSWORD = 'Correct-horse-9-battery';
const describeDb = await describeWithDb();

describeDb('revoking and converting seat technicians', { shuffle: false }, () => {
  let db: Knex;

  /** A PSA tenant with the catalog's permissions and default roles, `licensed` seats of its own all taken, and a pool. */
  const sponsorWithPool = async (licensed = 0, capacity = 10) => {
    const sponsor = await createTenant(db, `Revoke sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('roles').insert(getDefaultRoles('psa').filter((role: any) => !role.legacy).map((role: any) => ({
      tenant: sponsor, role_id: randomUUID(), role_name: role.roleName, msp: role.msp, client: role.client,
    })));
    await syncPermissionCatalog(db, sponsor, 'psa');
    await db('tenants').where({ tenant: sponsor }).update({ licensed_user_count: licensed || null, plan: 'pro' });
    await db('co_managed_entitlements').insert({ tenant: sponsor, source: 'hosted', source_reference: `sub_${randomUUID()}`,
      capacity, verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    for (let seat = 0; seat < licensed; seat += 1) await createUser(db, sponsor, { user_type: 'internal' });
    return sponsor;
  };
  const arrange = async (sponsorTenant: string, seats = 1) => createCoManagedSeatArrangement(db, { sponsorTenant,
    clientId: await createClient(db, sponsorTenant, `Seat client ${randomUUID().slice(0, 8)}`), operationId: randomUUID(), seats });
  const address = () => `tech.${randomUUID().slice(0, 12)}@client.example`;
  const invite = (sponsorTenant: string, arrangementId: string, email = address()) =>
    inviteCoManagedSeatTechnician(db, { sponsorTenant, arrangementId, email, firstName: 'Dana', lastName: 'Reyes' });
  /** A seat technician as acceptance leaves one. */
  const technician = async (sponsorTenant: string, arrangementId: string) => {
    const invitation = await invite(sponsorTenant, arrangementId);
    const accepted = await acceptCoManagedSeatInvitation(db, { token: invitation.token, password: PASSWORD });
    return { ...accepted, invitation };
  };

  const roleId = async (tenant: string, name: string) => (await db('roles').where({ tenant, role_name: name, msp: true }).first()).role_id;
  const rolesOf = (tenant: string, userId: string) => db('user_roles').where({ tenant, user_id: userId }).pluck('role_id');
  const userRow = (tenant: string, userId: string) => db('users').where({ tenant, user_id: userId }).first();
  const assignmentRow = (tenant: string, assignmentId: string) =>
    db('co_managed_seat_assignments').where({ tenant, assignment_id: assignmentId }).first();
  const liveSeats = async (tenant: string, arrangementId: string) => Number((await db('co_managed_seat_assignments')
    .where({ tenant, arrangement_id: arrangementId }).whereNot('state', 'revoked').count('* as count').first())?.count);
  const signIn = async (tenant: string, userId: string, times = 2) => {
    for (let i = 0; i < times; i += 1) {
      await db('sessions').insert({ tenant, user_id: userId, token: '', ip_address: '127.0.0.1', user_agent: 'test',
        device_fingerprint: 'test', device_name: 'test', device_type: 'desktop', expires_at: new Date(Date.now() + DAY),
        login_method: 'credentials', last_activity_at: new Date() });
    }
  };
  const liveSessions = async (tenant: string, userId: string) => Number((await db('sessions')
    .where({ tenant, user_id: userId }).whereNull('revoked_at').count('* as count').first())?.count);
  const refusedWith = async (promise: Promise<unknown>, code: string) => {
    const error: any = await promise.then(() => undefined, (rejection) => rejection);
    expect(error?.code).toBe(code);
    return error;
  };
  const serviceFor = <S extends object>(service: S, tenant: string): S => {
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant });
    return service;
  };

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 's10_seat_revoke_convert_test' });
  }, 300_000);
  afterAll(async () => { await db?.destroy(); });

  it('pins the guard\'s seat role identity to the seat role admission seeds', () => {
    expect(CO_MANAGED_SEAT_ROLE_NAME).toBe(CO_MANAGED_SEAT_ROLE.role_name);
  });

  // F022
  it('revokes an active seat: deactivates, strips the role and sessions, frees the seat', async () => {
    const sponsor = await sponsorWithPool();
    const arrangement = await arrange(sponsor, 1);
    const tech = await technician(sponsor, arrangement.arrangement_id);
    await signIn(sponsor, tech.user_id);
    expect((await userRow(sponsor, tech.user_id)).seat_reader).toBe(true);
    expect(await rolesOf(sponsor, tech.user_id)).toHaveLength(1);
    expect(await liveSessions(sponsor, tech.user_id)).toBe(2);
    // The seat is taken: the next invitation is refused.
    await refusedWith(invite(sponsor, arrangement.arrangement_id), 'SEAT_LIMIT');

    const revoked = await revokeCoManagedSeatAssignment(db, { sponsorTenant: sponsor, assignmentId: tech.assignment_id,
      arrangementId: arrangement.arrangement_id });

    expect(revoked).toEqual({ assignment_id: tech.assignment_id, arrangement_id: arrangement.arrangement_id,
      user_id: tech.user_id, revoked: true, sessions_revoked: 2 });
    expect(await assignmentRow(sponsor, tech.assignment_id)).toMatchObject({ state: 'revoked', ended_reason: 'revoked' });
    expect((await assignmentRow(sponsor, tech.assignment_id)).revoked_at).not.toBeNull();
    const user = await userRow(sponsor, tech.user_id);
    expect(user).toMatchObject({ is_inactive: true, seat_reader: false, user_type: 'internal' });
    expect(await rolesOf(sponsor, tech.user_id)).toEqual([]);
    expect(await liveSessions(sponsor, tech.user_id)).toBe(0);
    expect(await db('sessions').where({ tenant: sponsor, user_id: tech.user_id }).pluck('revoked_reason')).toEqual(['admin_revoke', 'admin_revoke']);

    // The committed seat is free: a new invitation fits where it was refused.
    expect(await liveSeats(sponsor, arrangement.arrangement_id)).toBe(0);
    const next = await invite(sponsor, arrangement.arrangement_id);
    expect(next.created).toBe(true);

    // Idempotent: a repeat changes nothing and says so.
    expect(await revokeCoManagedSeatAssignment(db, { sponsorTenant: sponsor, assignmentId: tech.assignment_id }))
      .toMatchObject({ revoked: false, sessions_revoked: 0 });
    expect(await liveSeats(sponsor, arrangement.arrangement_id)).toBe(1);
  });

  // F022
  it('refuses an assignment of another tenant or arrangement, and malformed requests', async () => {
    const sponsor = await sponsorWithPool();
    const other = await sponsorWithPool();
    const arrangement = await arrange(sponsor, 1);
    const elsewhere = await arrange(sponsor, 1);
    const tech = await technician(sponsor, arrangement.arrangement_id);

    await refusedWith(revokeCoManagedSeatAssignment(db, { sponsorTenant: other, assignmentId: tech.assignment_id }), 'ASSIGNMENT_NOT_FOUND');
    await refusedWith(revokeCoManagedSeatAssignment(db, { sponsorTenant: sponsor, assignmentId: tech.assignment_id,
      arrangementId: elsewhere.arrangement_id }), 'ASSIGNMENT_NOT_FOUND');
    await refusedWith(revokeCoManagedSeatAssignment(db, { sponsorTenant: sponsor, assignmentId: randomUUID() }), 'ASSIGNMENT_NOT_FOUND');
    await refusedWith(revokeCoManagedSeatAssignment(db, { sponsorTenant: sponsor, assignmentId: 'nope' }), 'INVALID_REQUEST');
    expect(await assignmentRow(sponsor, tech.assignment_id)).toMatchObject({ state: 'active', ended_reason: null });
    expect((await userRow(sponsor, tech.user_id)).is_inactive).toBe(false);
  });

  // F022
  it('revokes an invitation that was never accepted: the token opens nothing and the seat is free', async () => {
    const sponsor = await sponsorWithPool();
    const arrangement = await arrange(sponsor, 1);
    const invitation = await invite(sponsor, arrangement.arrangement_id);
    const usersBefore = Number((await db('users').where({ tenant: sponsor }).count('* as count').first())?.count);

    const revoked = await revokeCoManagedSeatAssignment(db, { sponsorTenant: sponsor, assignmentId: invitation.assignment_id });

    expect(revoked).toMatchObject({ revoked: true, user_id: null, sessions_revoked: 0 });
    expect(await assignmentRow(sponsor, invitation.assignment_id)).toMatchObject({ state: 'revoked', ended_reason: 'revoked' });
    const spent = await db('user_invitations').where({ tenant: sponsor, invitation_id: invitation.invitation_id }).first();
    expect(spent.used_at).not.toBeNull();
    // The link can no longer be accepted, and accepting creates no user.
    const error = await acceptCoManagedSeatInvitation(db, { token: invitation.token, password: PASSWORD }).catch((e) => e);
    expect(error).toBeInstanceOf(CoManagedSeatInvitationError);
    expect(error.code).toBe('INVITATION_REVOKED');
    expect(Number((await db('users').where({ tenant: sponsor }).count('* as count').first())?.count)).toBe(usersBefore);
    // The seat is free again.
    expect((await invite(sponsor, arrangement.arrangement_id)).created).toBe(true);
  });

  // F022
  it('cannot be reactivated as a plain MSP user, through the shared admission every reactivation path calls', async () => {
    const sponsor = await sponsorWithPool(2);
    await db('tenants').where({ tenant: sponsor }).update({ licensed_user_count: 50 });
    const arrangement = await arrange(sponsor, 2);
    const tech = await technician(sponsor, arrangement.arrangement_id);
    await revokeCoManagedSeatAssignment(db, { sponsorTenant: sponsor, assignmentId: tech.assignment_id });
    const ordinary = await createUser(db, sponsor, { user_type: 'internal', is_inactive: true });

    const admit = (userId: string) => db.transaction((trx) => admitInternalUserSeat(trx, sponsor, { existingUserId: userId }));
    // Plenty of MSP seats, and still refused: the seat, not the licence, is what was revoked.
    expect(await admit(tech.user_id)).toMatchObject({ ok: false, code: 'SEAT_ARRANGEMENT_REFUSED' });
    expect(await admit(ordinary)).toMatchObject({ ok: true });
    expect((await userRow(sponsor, tech.user_id)).is_inactive).toBe(true);
  });

  // F023
  it('refuses a conversion at the MSP seat limit and changes nothing; succeeds with a free seat', async () => {
    const sponsor = await sponsorWithPool(2);
    const arrangement = await arrange(sponsor, 1);
    const tech = await technician(sponsor, arrangement.arrangement_id);
    await signIn(sponsor, tech.user_id);
    const technicianRole = await roleId(sponsor, 'Technician');
    const [seatRole] = await rolesOf(sponsor, tech.user_id);
    // The technician is outside the licensed count; the two staff fill the MSP's two seats.
    expect(await countLicensedInternalUsers(db, sponsor)).toBe(2);
    const convert = (roleIds: string[]) => convertCoManagedSeatTechnicianToMspUser(db, { sponsorTenant: sponsor,
      assignmentId: tech.assignment_id, roleIds, seatAdmission: mspSeatAdmissionForConversion });

    const refused = await refusedWith(convert([technicianRole]), 'MSP_SEAT_LIMIT');
    expect(refused).toBeInstanceOf(CoManagedSeatEndError);
    expect(refused.admissionCode).toBe('LICENSE_LIMIT_REACHED');
    expect(await assignmentRow(sponsor, tech.assignment_id)).toMatchObject({ state: 'active', ended_reason: null, revoked_at: null });
    expect(await rolesOf(sponsor, tech.user_id)).toEqual([seatRole]);
    expect(await userRow(sponsor, tech.user_id)).toMatchObject({ is_inactive: false, seat_reader: true });
    expect(await liveSessions(sponsor, tech.user_id)).toBe(2);
    expect(await countLicensedInternalUsers(db, sponsor)).toBe(2);
    expect(await liveSeats(sponsor, arrangement.arrangement_id)).toBe(1);

    // A free MSP seat: admitted. (Not admitted-always: the refusal above is the same code path.)
    await db('tenants').where({ tenant: sponsor }).update({ licensed_user_count: 3 });
    const converted = await convert([technicianRole]);

    expect(converted).toEqual({ assignment_id: tech.assignment_id, arrangement_id: arrangement.arrangement_id,
      user_id: tech.user_id, role_ids: [technicianRole], sessions_revoked: 2 });
    expect(await assignmentRow(sponsor, tech.assignment_id)).toMatchObject({ state: 'revoked', ended_reason: 'converted' });
    expect((await assignmentRow(sponsor, tech.assignment_id)).revoked_at).not.toBeNull();
    expect(await rolesOf(sponsor, tech.user_id)).toEqual([technicianRole]);
    expect(await userRow(sponsor, tech.user_id)).toMatchObject({ is_inactive: false, seat_reader: false, user_type: 'internal' });
    expect(await liveSessions(sponsor, tech.user_id)).toBe(0);
    // Now an MSP licensed user, and the arrangement's seat is free.
    expect(await countLicensedInternalUsers(db, sponsor)).toBe(3);
    expect(await liveSeats(sponsor, arrangement.arrangement_id)).toBe(0);
    expect((await invite(sponsor, arrangement.arrangement_id)).created).toBe(true);

    // A converted user is MSP staff: it deactivates and reactivates like any other.
    await db('users').where({ tenant: sponsor, user_id: tech.user_id }).update({ is_inactive: true });
    expect(await db.transaction((trx) => admitInternalUserSeat(trx, sponsor, { existingUserId: tech.user_id }))).toMatchObject({ ok: true });
    // And converting again, or revoking, finds nothing live.
    await refusedWith(convert([technicianRole]), 'ASSIGNMENT_NOT_LIVE');
    expect(await revokeCoManagedSeatAssignment(db, { sponsorTenant: sponsor, assignmentId: tech.assignment_id }))
      .toMatchObject({ revoked: false });
  });

  // F023
  it('converts only to MSP roles other than the seat role, by assignment or by user', async () => {
    const sponsor = await sponsorWithPool(0);
    await db('tenants').where({ tenant: sponsor }).update({ licensed_user_count: 10 });
    const arrangement = await arrange(sponsor, 1);
    const tech = await technician(sponsor, arrangement.arrangement_id);
    const technicianRole = await roleId(sponsor, 'Technician');
    const [seatRole] = await rolesOf(sponsor, tech.user_id);
    const clientRole = (await db('roles').where({ tenant: sponsor, client: true, msp: false }).first())?.role_id;
    const convert = (roleIds: string[], by: object = { userId: tech.user_id }) => convertCoManagedSeatTechnicianToMspUser(db,
      { sponsorTenant: sponsor, roleIds, seatAdmission: mspSeatAdmissionForConversion, ...by });

    await refusedWith(convert([]), 'ROLE_REQUIRED');
    await refusedWith(convert([seatRole]), 'ROLE_NOT_ALLOWED');
    await refusedWith(convert([technicianRole, seatRole]), 'ROLE_NOT_ALLOWED');
    await refusedWith(convert([randomUUID()]), 'ROLE_NOT_ALLOWED');
    if (clientRole) await refusedWith(convert([clientRole]), 'ROLE_NOT_ALLOWED');
    await refusedWith(convert([technicianRole], { userId: tech.user_id, assignmentId: tech.assignment_id }), 'INVALID_REQUEST');
    await refusedWith(convert([technicianRole], { userId: randomUUID() }), 'ASSIGNMENT_NOT_LIVE');
    expect(await rolesOf(sponsor, tech.user_id)).toEqual([seatRole]);

    expect(await convert([technicianRole])).toMatchObject({ user_id: tech.user_id, role_ids: [technicianRole] });
  });

  // F024
  it('refuses a non-seat role for a live seat technician through every role writer, and serves an ordinary user', async () => {
    const sponsor = await sponsorWithPool(1);
    const arrangement = await arrange(sponsor, 1);
    const tech = await technician(sponsor, arrangement.arrangement_id);
    const ordinary = await createUser(db, sponsor, { user_type: 'internal' });
    const technicianRole = await roleId(sponsor, 'Technician');
    const adminRole = await roleId(sponsor, 'Admin');
    const [seatRole] = await rolesOf(sponsor, tech.user_id);
    const roles = serviceFor(new PermissionRoleService(), sponsor);
    const context = { tenant: sponsor, userId: ordinary } as any;

    // REST: assign and replace.
    await refusedWith(roles.assignRolesToUser(tech.user_id, [technicianRole], context), 'SEAT_TECHNICIAN_ROLE_REFUSED');
    await refusedWith(roles.replaceUserRoles(tech.user_id, [adminRole, seatRole], context), 'SEAT_TECHNICIAN_ROLE_REFUSED');
    // The shared model.
    const refusal = await runWithTenant(sponsor, () => db.transaction((trx) => User.updateUserRoles(trx, tech.user_id, [{ role_id: technicianRole } as any])))
      .then(() => undefined, (error) => error);
    expect(refusal).toBeInstanceOf(SeatTechnicianGuardError);
    expect(isSeatTechnicianGuardError(refusal)).toBe(true);
    expect(refusal).toMatchObject({ code: 'SEAT_TECHNICIAN_ROLE_REFUSED', statusCode: 409, userIds: [tech.user_id] });
    // Nothing was written, and the seat role is still acceptable to every writer.
    expect(await rolesOf(sponsor, tech.user_id)).toEqual([seatRole]);
    await roles.replaceUserRoles(tech.user_id, [seatRole], context);
    await runWithTenant(sponsor, () => db.transaction((trx) => User.updateUserRoles(trx, tech.user_id, [{ role_id: seatRole } as any])));
    expect(await rolesOf(sponsor, tech.user_id)).toEqual([seatRole]);

    // An ordinary internal user takes any role through the same writers.
    await roles.assignRolesToUser(ordinary, [technicianRole], context);
    await roles.replaceUserRoles(ordinary, [technicianRole, adminRole], context);
    await runWithTenant(sponsor, () => db.transaction((trx) => User.updateUserRoles(trx, ordinary, [{ role_id: technicianRole } as any, { role_id: adminRole } as any])));
    expect((await rolesOf(sponsor, ordinary)).sort()).toEqual([technicianRole, adminRole].sort());

    // A revoked technician is no longer bound by the guard (they hold nothing and cannot be reactivated).
    await revokeCoManagedSeatAssignment(db, { sponsorTenant: sponsor, assignmentId: tech.assignment_id });
    await db.transaction((trx) => assertSeatTechnicianWrite(trx, sponsor, [tech.user_id], { roleIds: [technicianRole] }));
  });

  // F024
  it('refuses a live seat technician on an MSP team, as member or manager, and serves an ordinary user', async () => {
    const sponsor = await sponsorWithPool(2);
    const arrangement = await arrange(sponsor, 1);
    const tech = await technician(sponsor, arrangement.arrangement_id);
    const [lead, ordinary] = [await createUser(db, sponsor, { user_type: 'internal' }), await createUser(db, sponsor, { user_type: 'internal' })];
    const teamId = randomUUID();
    await db('teams').insert({ tenant: sponsor, team_id: teamId, team_name: 'Service desk', manager_id: lead });
    await db('team_members').insert({ tenant: sponsor, team_id: teamId, user_id: lead, role: 'lead' });
    const members = async () => (await db('team_members').where({ tenant: sponsor, team_id: teamId }).pluck('user_id')).sort();
    const teams = serviceFor(new TeamService(), sponsor);
    const context = { tenant: sponsor, userId: lead } as any;

    // The teams model: add, create and re-lead.
    expect((await Team.addMember(db, sponsor, teamId, tech.user_id).catch((e) => e)).code).toBe('SEAT_TECHNICIAN_TEAM_REFUSED');
    expect((await Team.update(db, sponsor, teamId, { manager_id: tech.user_id }).catch((e) => e)).code).toBe('SEAT_TECHNICIAN_TEAM_REFUSED');
    expect((await Team.create(db, sponsor, { team_name: 'Led by a technician', manager_id: tech.user_id } as any).catch((e) => e)).code)
      .toBe('SEAT_TECHNICIAN_TEAM_REFUSED');
    // The REST service: one, many, manager, and the other add path.
    await refusedWith(teams.addMember(teamId, tech.user_id, context), 'SEAT_TECHNICIAN_TEAM_REFUSED');
    await refusedWith(teams.addMembers(teamId, [ordinary, tech.user_id], context), 'SEAT_TECHNICIAN_TEAM_REFUSED');
    await refusedWith(teams.assignManager(teamId, tech.user_id, context), 'SEAT_TECHNICIAN_TEAM_REFUSED');
    await refusedWith(teams.addTeamMember(teamId, { user_id: tech.user_id }, context), 'SEAT_TECHNICIAN_TEAM_REFUSED');
    expect(await members()).toEqual([lead]);
    expect(await db('teams').where({ tenant: sponsor, team_id: teamId }).first('manager_id')).toEqual({ manager_id: lead });

    // An ordinary internal user joins through the same writers.
    await Team.addMember(db, sponsor, teamId, ordinary);
    expect(await members()).toEqual([lead, ordinary].sort());
    await teams.removeMember(teamId, ordinary, context);
    await teams.addMembers(teamId, [ordinary], context);
    expect(await members()).toEqual([lead, ordinary].sort());
  });

  // F024
  it('asks nothing of tenants with no seat assignment: ids it does not know, and no ids, pass', async () => {
    const sponsor = await sponsorWithPool(1);
    const ordinary = await createUser(db, sponsor, { user_type: 'internal' });
    await db.transaction(async (trx) => {
      await assertSeatTechnicianWrite(trx, sponsor, [], { teamMembership: true });
      await assertSeatTechnicianWrite(trx, sponsor, [undefined, null], { roleIds: [randomUUID()] });
      await assertSeatTechnicianWrite(trx, sponsor, [ordinary, randomUUID()], { teamMembership: true });
      await assertSeatTechnicianWrite(trx, sponsor, [ordinary], { roleIds: [] });
      await assertSeatTechnicianWrite(trx, sponsor, [ordinary], { roleIds: [await roleId(sponsor, 'Admin')] });
    });
  });
});
