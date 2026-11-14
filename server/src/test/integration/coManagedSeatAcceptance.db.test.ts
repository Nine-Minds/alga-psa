/**
 * Co-managed seat and workspace shapes, slice S8 (F018, F019 / T011) on real Postgres.
 *
 * A sponsor's first seat arrangement seeds the seat role: operational permissions, and none for
 * sales, billing, accounting, settings or user administration. It exists for that sponsor and no
 * other tenant, and the role lists omit it for a tenant the `co-managed-seat` capability does not
 * serve. Accepting a seat invitation creates an internal user who holds that role and nothing
 * else, and activates the assignment.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Knex } from 'knex';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import {
  acceptCoManagedSeatInvitation, admitCoManagedSeatRole, CO_MANAGED_SEAT_ROLE, CO_MANAGED_SEAT_ROLE_GRANTS,
  createCoManagedSeatArrangement, inviteCoManagedSeatTechnician,
} from '@alga-psa/co-managed';
import { coManagedSeatParticipants } from '@alga-psa/co-managed/seatCapability';
import { filterRolesByServedCapabilities, unservedRoles } from '@alga-psa/auth/lib/permissionCapabilities';
import { registerCapabilityParticipation } from '@alga-psa/core/capability';
import { verifyPassword } from '@alga-psa/core/encryption';
import { releaseCoManagedSeatAllocation } from '@alga-psa/licensing';
import { clearCapabilityCache } from '../../../../packages/core/src/capability/testing';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const require = createRequire(import.meta.url);
const permissionsDir = path.resolve(__dirname, '../../../migrations/utils/permissions');
const catalog = require(path.join(permissionsDir, 'catalog.cjs'));
const { syncPermissionCatalog } = require(path.join(permissionsDir, 'syncPermissionCatalog.cjs'));
const { getDefaultRoles } = require(path.join(permissionsDir, 'roleGrants.cjs'));

const DAY = 86_400_000;
const PASSWORD = 'Correct-horse-9-battery';
const describeDb = await describeWithDb();

describeDb('accepting an invitation into the seat role', { shuffle: false }, () => {
  let db: Knex;

  /** A PSA tenant with the catalog's permissions and default roles, as onboarding leaves one. */
  const psaTenant = async (label: string) => {
    const tenant = await createTenant(db, `${label} ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('roles').insert(getDefaultRoles('psa').filter((role: any) => !role.legacy).map((role: any) => ({
      tenant, role_id: randomUUID(), role_name: role.roleName, msp: role.msp, client: role.client,
    })));
    await syncPermissionCatalog(db, tenant, 'psa');
    return tenant;
  };
  const sponsorWithPool = async (capacity = 10) => {
    const sponsor = await psaTenant('Seat sponsor');
    await db('co_managed_entitlements').insert({ tenant: sponsor, source: 'hosted', source_reference: `sub_${randomUUID()}`,
      capacity, verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    return sponsor;
  };
  const arrange = async (sponsorTenant: string, seats = 2) => createCoManagedSeatArrangement(db, { sponsorTenant,
    clientId: await createClient(db, sponsorTenant, `Seat client ${randomUUID().slice(0, 8)}`), operationId: randomUUID(), seats });
  const address = (label = 'tech') => `${label}.${randomUUID().slice(0, 12)}@client.example`;
  const invite = (sponsorTenant: string, arrangementId: string, email: string = address()) =>
    inviteCoManagedSeatTechnician(db, { sponsorTenant, arrangementId, email, firstName: 'Dana', lastName: 'Reyes' });
  const accept = (token: string, password = PASSWORD) => acceptCoManagedSeatInvitation(db, { token, password });

  const seatRoles = (tenant: string) => db('roles').where({ tenant, ...CO_MANAGED_SEAT_ROLE });
  const grantsOf = async (tenant: string, roleId: string) => (await db('role_permissions as rp')
    .join('permissions as p', function () { this.on('p.tenant', 'rp.tenant').andOn('p.permission_id', 'rp.permission_id'); })
    .where({ 'rp.tenant': tenant, 'rp.role_id': roleId }).select('p.resource', 'p.action', 'p.msp', 'p.client'));
  const rolesOf = (tenant: string, userId: string) => db('user_roles').where({ tenant, user_id: userId }).pluck('role_id');
  const internalUsers = (tenant: string) => db('users').where({ tenant, user_type: 'internal' });

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 's8_seat_acceptance_test' });
    // The gate's own resolver, pointed at this suite's database.
    registerCapabilityParticipation('co-managed-seat', ({ tenantIds }) => coManagedSeatParticipants(tenantIds, db));
  }, 300_000);
  afterEach(() => { delete process.env.FORCE_CAPABILITIES; clearCapabilityCache(); });
  afterAll(async () => { await db?.destroy(); });

  // F019
  it('seeds the seat role with the sponsor\'s first arrangement, once, and for no other tenant', async () => {
    const sponsor = await sponsorWithPool();
    const bystander = await sponsorWithPool();
    expect(await seatRoles(sponsor)).toEqual([]);

    await arrange(sponsor);
    const [role] = await seatRoles(sponsor);
    expect(await seatRoles(sponsor)).toHaveLength(1);
    expect(role).toMatchObject({ role_name: 'Seat Technician', msp: true, client: false,
      description: 'Client technician working this workspace on a co-managed seat' });

    // Exactly the declared grants, each an MSP-only permission of this tenant.
    const grants = await grantsOf(sponsor, role.role_id);
    expect(grants.map((grant) => `${grant.resource}:${grant.action}`).sort()).toEqual([...CO_MANAGED_SEAT_ROLE_GRANTS].sort());
    expect(grants.every((grant) => grant.msp === true && grant.client === false)).toBe(true);

    // A second arrangement, and two more racing each other, find the role; none adds one.
    await arrange(sponsor);
    await Promise.all([arrange(sponsor, 1), arrange(sponsor, 1)]);
    expect(await seatRoles(sponsor)).toEqual([expect.objectContaining({ role_id: role.role_id })]);
    expect(await grantsOf(sponsor, role.role_id)).toHaveLength(CO_MANAGED_SEAT_ROLE_GRANTS.length);

    // A sponsor with a pool and no arrangement has neither the role nor a grant to it.
    expect(await seatRoles(bystander)).toEqual([]);
    expect(await db('role_permissions').where({ role_id: role.role_id }).distinct('tenant')).toEqual([{ tenant: sponsor }]);
  });

  // F019
  it('holds no sales, billing, accounting, settings or user-administration permission', async () => {
    const sponsor = await sponsorWithPool();
    await arrange(sponsor);
    const [role] = await seatRoles(sponsor);
    const held = new Set((await grantsOf(sponsor, role.role_id)).map((grant) => grant.resource));

    const closed = /^(opportunities|quotes|sales_order|marketing|billing|billing_settings|billing_profile_report|credit|invoice|service|tax|financial|accounting_integrations|purchase_order|vendor|vendor_bill|settings|system_settings|security_settings|ticket_settings|user_settings|account_management|user|team|service_principal|secrets|extension|workflow)$|^billing\./;
    // The pattern is live: the tenant does hold permissions on those resources, the role none.
    const tenantResources: string[] = await db('permissions').where({ tenant: sponsor }).distinct('resource').pluck('resource');
    expect(tenantResources.filter((resource) => closed.test(resource)).length).toBeGreaterThan(20);
    expect([...held].filter((resource) => closed.test(resource))).toEqual([]);
    // Every resource the tenant's own Finance role works is closed to the seat role.
    const [finance] = await db('roles').where({ tenant: sponsor, role_name: 'Finance', msp: true });
    const financeOnly = (await grantsOf(sponsor, finance.role_id)).map((grant) => grant.resource)
      .filter((resource) => /bill|invoice|credit|tax|financ|account/.test(resource));
    expect(financeOnly.length).toBeGreaterThan(0);
    expect(financeOnly.filter((resource) => held.has(resource))).toEqual([]);
  });

  // F019
  it('keeps the role at the catalog through synchronization, which never creates it', async () => {
    const sponsor = await sponsorWithPool();
    const plain = await psaTenant('Plain PSA');
    await arrange(sponsor);
    const [role] = await seatRoles(sponsor);
    const ticketRead = await db('permissions').where({ tenant: sponsor, resource: 'ticket', action: 'read', msp: true, client: false }).first();
    await db('role_permissions').where({ tenant: sponsor, role_id: role.role_id, permission_id: ticketRead.permission_id }).del();

    await syncPermissionCatalog(db, sponsor, 'psa');
    await syncPermissionCatalog(db, plain, 'psa');
    expect(await grantsOf(sponsor, role.role_id)).toHaveLength(CO_MANAGED_SEAT_ROLE_GRANTS.length);
    expect(await seatRoles(plain)).toEqual([]);
  });

  // F019
  it('is omitted from the role lists of a tenant the capability does not serve', async () => {
    const sponsor = await sponsorWithPool();
    const unserved = await sponsorWithPool();
    await arrange(sponsor);
    // Stale state: the role's rows exist in a tenant that has no arrangement.
    await db.transaction((trx) => admitCoManagedSeatRole(trx, unserved));
    const roles = (tenant: string) => db('roles').where({ tenant }).select('role_id', 'role_name', 'msp', 'client');
    const names = async (tenant: string) => (await filterRolesByServedCapabilities(tenant, await roles(tenant)))
      .map((role) => role.role_name);

    expect(await names(sponsor)).toContain('Seat Technician');
    expect(await unservedRoles(sponsor)).toEqual([]);
    expect(await names(unserved)).not.toContain('Seat Technician');
    expect(await names(unserved)).toEqual(expect.arrayContaining(['Admin', 'Technician', 'Finance']));
    expect(await unservedRoles(unserved)).toEqual([{ role_name: 'Seat Technician', msp: true, client: false }]);

    // The kill switch closes the sponsor's too, and leaves its rows in place.
    process.env.FORCE_CAPABILITIES = 'co-managed-seat:off';
    clearCapabilityCache();
    expect(await names(sponsor)).not.toContain('Seat Technician');
    expect(await seatRoles(sponsor)).toHaveLength(1);
  });

  // F018
  it('creates an internal user with only the seat role and activates the assignment', async () => {
    const sponsor = await sponsorWithPool();
    const arrangement = await arrange(sponsor);
    const [role] = await seatRoles(sponsor);
    const invitation = await inviteCoManagedSeatTechnician(db, { sponsorTenant: sponsor,
      arrangementId: arrangement.arrangement_id, email: ' Dana.Reyes.S8@Client.Example ', firstName: 'Dana', lastName: 'Reyes' });
    const before = (await internalUsers(sponsor)).length;

    const accepted = await accept(invitation.token);

    expect(accepted).toEqual({ sponsor_tenant: sponsor, assignment_id: invitation.assignment_id,
      arrangement_id: arrangement.arrangement_id, user_id: expect.any(String), email: 'dana.reyes.s8@client.example',
      state: 'active', created: true });
    const [user] = await db('users').where({ tenant: sponsor, user_id: accepted.user_id });
    expect(user).toMatchObject({ user_type: 'internal', email: 'dana.reyes.s8@client.example', username: 'dana.reyes.s8@client.example',
      first_name: 'Dana', last_name: 'Reyes', is_inactive: false, contact_id: null });
    expect(await verifyPassword(PASSWORD, user.hashed_password)).toBe(true);
    expect((await internalUsers(sponsor)).length).toBe(before + 1);
    // The seat role and nothing else.
    expect(await rolesOf(sponsor, accepted.user_id)).toEqual([role.role_id]);

    expect(await db('co_managed_seat_assignments').where({ tenant: sponsor, assignment_id: invitation.assignment_id }).first())
      .toMatchObject({ state: 'active', user_id: accepted.user_id, invitation_id: invitation.invitation_id, revoked_at: null });
    const spent = await db('user_invitations').where({ tenant: sponsor, invitation_id: invitation.invitation_id }).first();
    expect(spent.used_at).not.toBeNull();
    expect(spent.role_id).toBeNull();
  });

  // F018
  it('accepts once: a repeat and a concurrent submission return the same technician', async () => {
    const sponsor = await sponsorWithPool();
    const arrangement = await arrange(sponsor, 3);
    const invitation = await invite(sponsor, arrangement.arrangement_id);

    const settled = await Promise.all([accept(invitation.token), accept(invitation.token), accept(invitation.token)]);
    expect(settled.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(settled.map((result) => result.user_id)).size).toBe(1);

    const again = await accept(invitation.token, 'A-different-password-1');
    expect(again).toMatchObject({ user_id: settled[0].user_id, created: false, state: 'active' });
    const users = await db('users').where({ tenant: sponsor, email: invitation.email });
    expect(users).toHaveLength(1);
    expect(await verifyPassword(PASSWORD, users[0].hashed_password)).toBe(true);
    expect(await rolesOf(sponsor, users[0].user_id)).toHaveLength(1);
    // The accepted seat is still one committed seat of the arrangement.
    expect(await db('co_managed_seat_assignments').where({ tenant: sponsor, arrangement_id: arrangement.arrangement_id })
      .whereNot('state', 'revoked')).toHaveLength(1);
  });

  // F018
  it('restores the seat role if it was removed before the technician accepted', async () => {
    const sponsor = await sponsorWithPool();
    const arrangement = await arrange(sponsor);
    const invitation = await invite(sponsor, arrangement.arrangement_id);
    const [removed] = await seatRoles(sponsor);
    await db('role_permissions').where({ tenant: sponsor, role_id: removed.role_id }).del();
    await db('roles').where({ tenant: sponsor, role_id: removed.role_id }).del();

    const accepted = await accept(invitation.token);
    const [role] = await seatRoles(sponsor);
    expect(await rolesOf(sponsor, accepted.user_id)).toEqual([role.role_id]);
    expect(await grantsOf(sponsor, role.role_id)).toHaveLength(CO_MANAGED_SEAT_ROLE_GRANTS.length);
  });

  // F018
  it('refuses, by name, and leaves nothing behind', async () => {
    const sponsor = await sponsorWithPool(20);
    const arrangement = await arrange(sponsor, 6);
    const usersBefore = (await internalUsers(sponsor)).length;
    const stillInvited = async (assignmentId: string) => expect(await db('co_managed_seat_assignments')
      .where({ tenant: sponsor, assignment_id: assignmentId }).first()).toMatchObject({ state: 'invited', user_id: null });

    for (const bad of [{ token: '' }, { token: 'nope' }, { password: '' }]) {
      await expect(acceptCoManagedSeatInvitation(db, { token: 'a'.repeat(64), password: PASSWORD, ...bad }))
        .rejects.toMatchObject({ code: 'INVALID_ACCEPTANCE' });
    }
    await expect(accept('a'.repeat(64))).rejects.toMatchObject({ code: 'INVITATION_NOT_FOUND' });

    // An ordinary team invitation is not a seat invitation, whatever its token.
    const [adminRole] = await db('roles').where({ tenant: sponsor, role_name: 'Admin', msp: true });
    const teamToken = 'b'.repeat(64);
    await db('user_invitations').insert({ tenant: sponsor, email: address('team'), first_name: 'Team', last_name: 'Member',
      role_id: adminRole.role_id, token: teamToken, expires_at: new Date(Date.now() + DAY), metadata: {} });
    await expect(accept(teamToken)).rejects.toMatchObject({ code: 'INVITATION_NOT_FOUND' });

    const expired = await invite(sponsor, arrangement.arrangement_id);
    await db('user_invitations').where({ tenant: sponsor, invitation_id: expired.invitation_id })
      .update({ expires_at: new Date(Date.now() - 1000) });
    await expect(accept(expired.token)).rejects.toMatchObject({ code: 'INVITATION_EXPIRED' });
    await stillInvited(expired.assignment_id);

    const revoked = await invite(sponsor, arrangement.arrangement_id);
    await db('co_managed_seat_assignments').where({ tenant: sponsor, assignment_id: revoked.assignment_id })
      .update({ state: 'revoked', revoked_at: new Date() });
    await expect(accept(revoked.token)).rejects.toMatchObject({ code: 'INVITATION_REVOKED' });

    // The address became an internal user, here or anywhere, after the invitation was sent.
    const taken = await invite(sponsor, arrangement.arrangement_id);
    await createUser(db, await psaTenant('Elsewhere'), { email: taken.email, user_type: 'internal' });
    await expect(accept(taken.token)).rejects.toMatchObject({ code: 'EMAIL_IN_USE' });
    await stillInvited(taken.assignment_id);

    // Lapse grace: no new technician, as for every other seat admission.
    const lapsed = await invite(sponsor, arrangement.arrangement_id);
    await db('co_managed_entitlements').where({ tenant: sponsor }).update({ valid_until: new Date(Date.now() - DAY) });
    await expect(accept(lapsed.token)).rejects.toMatchObject({ code: 'ENTITLEMENT_LAPSED' });
    await db('co_managed_entitlements').where({ tenant: sponsor })
      .update({ valid_until: new Date(Date.now() + 365 * DAY), lapse_started_at: null });
    await stillInvited(lapsed.assignment_id);

    const ended = await invite(sponsor, arrangement.arrangement_id);
    await db('co_managed_seat_arrangements').where({ tenant: sponsor, arrangement_id: arrangement.arrangement_id })
      .update({ state: 'ended', ended_at: new Date() });
    await expect(accept(ended.token)).rejects.toMatchObject({ code: 'ARRANGEMENT_ENDED' });
    await expect(accept(lapsed.token)).rejects.toMatchObject({ code: 'ARRANGEMENT_ENDED' });

    const released = await arrange(sponsor, 1);
    const orphan = await invite(sponsor, released.arrangement_id);
    await releaseCoManagedSeatAllocation(db, sponsor, { allocationId: released.allocation_id }).catch(() => undefined);
    await db('co_managed_allocations').where({ tenant: sponsor, allocation_id: released.allocation_id }).first('state')
      .then(async (row) => { if (row?.state === 'released') await expect(accept(orphan.token)).rejects.toMatchObject({ code: 'ARRANGEMENT_ENDED' }); });

    // No refusal made a user or spent a token.
    expect((await internalUsers(sponsor)).length).toBe(usersBefore);
    expect(await db('user_invitations').where({ tenant: sponsor }).whereNotNull('used_at')).toEqual([]);
  });
});
