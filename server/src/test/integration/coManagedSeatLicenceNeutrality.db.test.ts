/**
 * Co-managed seat and workspace shapes, slice S9 (F020, F021 / T012) on real Postgres.
 *
 * Seat technicians are internal users of the sponsor tenant, but they are paid for by their
 * arrangement's allocation. With the sponsor at its own licensed seat limit, technicians can
 * still be added up to the allocation, and every licence count reads the same number it read
 * before they existed. A tenant without seat assignments counts exactly as it always did.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createCoManagedSeatArrangement, inviteCoManagedSeatTechnician } from '@alga-psa/co-managed';
import {
  admitCoManagedSeatTechnician, countLicensedInternalUsers, findPendingInvitation, countLicensedPendingInvitations, getLicenseUsage,
} from '@alga-psa/licensing';
import {
  admitInternalUserSeat, assertInternalUserSeatsWithinLimit, checkInternalUserLicenseLimit, countPendingInvitationSeats,
} from '../../../../packages/users/src/lib/internalUserLicenseGuard';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

// The EE appliance seat check is handed the licensed count by the seat guard; record what it is given.
const appliance = vi.hoisted(() => ({ usedSeats: [] as number[] }));
vi.mock('@enterprise/lib/license/userSeatGuard', () => ({
  checkApplianceLicenseSeatLimit: async (usedSeats: number) => { appliance.usedSeats.push(usedSeats); return null; },
}));

const DAY = 86_400_000;
const describeDb = await describeWithDb();

describeDb('seat technicians do not consume MSP licences', { shuffle: false }, () => {
  let db: Knex;

  /** A Pro PSA tenant with `licensed` seats, all of them taken, and a co-managed pool. */
  const sponsorAtItsLimit = async (licensed: number, capacity = 10) => {
    const sponsor = await createTenant(db, `Licence sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('tenants').where({ tenant: sponsor }).update({ licensed_user_count: licensed, plan: 'pro' });
    await db('co_managed_entitlements').insert({ tenant: sponsor, source: 'hosted', source_reference: `sub_${randomUUID()}`,
      capacity, verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    for (let seat = 0; seat < licensed; seat += 1) await createUser(db, sponsor, { user_type: 'internal' });
    return sponsor;
  };
  const arrange = async (sponsorTenant: string, seats: number) => createCoManagedSeatArrangement(db, {
    sponsorTenant, clientId: await createClient(db, sponsorTenant, `Seat client ${randomUUID().slice(0, 8)}`),
    operationId: randomUUID(), seats,
  });
  const address = () => `tech.${randomUUID().slice(0, 12)}@client.example`;
  const invite = (sponsorTenant: string, arrangementId: string, email = address()) =>
    inviteCoManagedSeatTechnician(db, { sponsorTenant, arrangementId, email, firstName: 'Dana', lastName: 'Reyes' });
  /** What acceptance leaves behind: the technician is an active internal user holding the assignment. */
  const accept = async (sponsor: string, invitation: { assignment_id: string; invitation_id: string; email: string }) => {
    const userId = await createUser(db, sponsor, { user_type: 'internal', email: invitation.email });
    await db('user_invitations').where({ tenant: sponsor, invitation_id: invitation.invitation_id }).update({ used_at: new Date() });
    await db('co_managed_seat_assignments').where({ tenant: sponsor, assignment_id: invitation.assignment_id })
      .update({ state: 'active', user_id: userId });
    return userId;
  };

  /** Every licence reading the MSP's own seat limit is decided on. */
  const licenceReadings = (sponsor: string) => db.transaction(async (trx) => {
    appliance.usedSeats.length = 0;
    const usage = await getLicenseUsage(sponsor, trx);
    return {
      licensedUsers: await countLicensedInternalUsers(trx, sponsor),
      usage,
      // What onboarding reports: licence usage plus the invitations reserving a licensed seat.
      onboardingUsed: usage.used + await countPendingInvitationSeats(trx, sponsor),
      pendingInvitations: await countLicensedPendingInvitations(trx, sponsor),
      // The seat guard, which also feeds this count to the appliance seat check.
      seatGuard: await checkInternalUserLicenseLimit(trx, sponsor),
      // What the appliance seat check was handed, when the limits before it did not refuse first.
      applianceUsedSeats: [...appliance.usedSeats],
    };
  });
  const admit = (sponsor: string, options: Parameters<typeof admitInternalUserSeat>[2]) =>
    db.transaction((trx) => admitInternalUserSeat(trx, sponsor, options));
  const activeInternalUsers = async (tenant: string) =>
    Number((await db('users').where({ tenant, user_type: 'internal', is_inactive: false }).count('* as count').first())?.count);

  beforeAll(async () => { db = await createTestDbConnection({ databaseName: 's9_seat_licence_neutrality_test' }); }, 300_000);
  afterAll(async () => { await db?.destroy(); });

  it('adds technicians up to the allocation while the MSP is at its licensed limit, and no licence count moves', async () => {
    const sponsor = await sponsorAtItsLimit(2);
    const before = await licenceReadings(sponsor);
    expect(before).toMatchObject({ licensedUsers: 2, usage: { limit: 2, used: 2, remaining: 0 }, onboardingUsed: 2,
      pendingInvitations: 0, seatGuard: { ok: false, code: 'LICENSE_LIMIT_REACHED' } });

    const arrangement = await arrange(sponsor, 2);
    const first = await invite(sponsor, arrangement.arrangement_id);
    const second = await invite(sponsor, arrangement.arrangement_id);
    // The allocation, not the MSP's licence, is what a technician runs out of.
    await expect(invite(sponsor, arrangement.arrangement_id)).rejects.toMatchObject({ code: 'SEAT_LIMIT' });

    // The MSP's own invitation flow must leave a seat invitation to the seat flow.
    expect(await findPendingInvitation(db, sponsor, ` ${first.email.toUpperCase()} `))
      .toEqual({ invitationId: first.invitation_id, seatInvitation: true });
    expect(await findPendingInvitation(db, sponsor, address())).toBeNull();

    // Two pending seat invitations: none reserves a licensed seat.
    expect(await licenceReadings(sponsor)).toEqual(before);

    // The invitation holder is admitted against the allocation, at the MSP's limit.
    expect(await admit(sponsor, { kind: 'user', email: first.email, invitationToken: first.token }))
      .toEqual({ ok: true, seatTechnician: true });
    // The token admits only the email it was issued for; anyone else meets the MSP's limit.
    expect(await admit(sponsor, { kind: 'user', email: address(), invitationToken: first.token }))
      .toMatchObject({ ok: false, code: 'LICENSE_LIMIT_REACHED' });

    const technician = await accept(sponsor, first);
    await accept(sponsor, second);
    expect(await activeInternalUsers(sponsor)).toBe(4);
    expect(await licenceReadings(sponsor)).toEqual(before);

    // An ordinary internal user is still refused: the MSP's limit did not loosen.
    expect(await admit(sponsor, { kind: 'user', email: address() })).toMatchObject({ ok: false, code: 'LICENSE_LIMIT_REACHED' });
    await expect(invite(sponsor, arrangement.arrangement_id)).rejects.toMatchObject({ code: 'SEAT_LIMIT' });

    // Reactivation and directory provisioning arrive with the existing user.
    await db('users').where({ tenant: sponsor, user_id: technician }).update({ is_inactive: true });
    await db.transaction(async (trx) => {
      const admission = await admitInternalUserSeat(trx, sponsor, { kind: 'user', existingUserId: technician });
      expect(admission).toEqual({ ok: true, seatTechnician: true });
      await trx('users').where({ tenant: sponsor, user_id: technician }).update({ is_inactive: false });
      await assertInternalUserSeatsWithinLimit(trx, sponsor, admission);
    });
    expect(await licenceReadings(sponsor)).toEqual(before);

    // An ordinary inactive user at the limit is refused on the same path.
    const ordinary = await createUser(db, sponsor, { user_type: 'internal', is_inactive: true });
    expect(await admit(sponsor, { kind: 'user', existingUserId: ordinary })).toMatchObject({ ok: false, code: 'LICENSE_LIMIT_REACHED' });
  });

  it('refuses a technician whose arrangement has ended or whose pool has lapsed, never falling back to the MSP licence', async () => {
    // Room on the MSP's own licence: a fallback to it would admit the technician.
    const sponsor = await sponsorAtItsLimit(1);
    await db('tenants').where({ tenant: sponsor }).update({ licensed_user_count: 50 });
    const seated = async () => {
      const arrangement = await arrange(sponsor, 1);
      const technician = await accept(sponsor, await invite(sponsor, arrangement.arrangement_id));
      await db('users').where({ tenant: sponsor, user_id: technician }).update({ is_inactive: true });
      expect(await admit(sponsor, { kind: 'user', existingUserId: technician })).toEqual({ ok: true, seatTechnician: true });
      return { arrangement, technician };
    };
    const ended = await seated();
    const lapsed = await seated();

    await db('co_managed_seat_arrangements').where({ tenant: sponsor, arrangement_id: ended.arrangement.arrangement_id })
      .update({ state: 'ended', ended_at: new Date() });
    expect(await admit(sponsor, { kind: 'user', existingUserId: ended.technician }))
      .toEqual({ ok: false, code: 'SEAT_ARRANGEMENT_REFUSED', error: 'This seat arrangement has ended.' });

    await db('co_managed_entitlements').where({ tenant: sponsor }).update({ capacity: 0 });
    expect(await db.transaction((trx) => admitCoManagedSeatTechnician(trx, sponsor, { existingUserId: lapsed.technician })))
      .toMatchObject({ seatTechnician: true, ok: false, reason: 'ENTITLEMENT_LAPSED' });
    // Reported as the arrangement's refusal, never as the MSP's licence limit.
    expect(await admit(sponsor, { kind: 'user', existingUserId: lapsed.technician }))
      .toMatchObject({ ok: false, code: 'SEAT_ARRANGEMENT_REFUSED' });
  });

  it('counts a revoked technician as a licensed user again, and a tenant without seat assignments exactly as before', async () => {
    const sponsor = await sponsorAtItsLimit(2);
    const arrangement = await arrange(sponsor, 1);
    const invitation = await invite(sponsor, arrangement.arrangement_id);
    const technician = await accept(sponsor, invitation);
    expect(await countLicensedInternalUsers(db, sponsor)).toBe(2);

    // Live means not revoked. What revocation does to the user is S10's; the count only follows the assignment.
    await db('co_managed_seat_assignments').where({ tenant: sponsor, assignment_id: invitation.assignment_id })
      .update({ state: 'revoked', revoked_at: new Date() });
    expect(await countLicensedInternalUsers(db, sponsor)).toBe(3);
    expect(await db.transaction((trx) => admitCoManagedSeatTechnician(trx, sponsor, { existingUserId: technician })))
      .toEqual({ seatTechnician: false });
    // Accepted, so no longer pending at all.
    expect(await findPendingInvitation(db, sponsor, invitation.email)).toBeNull();

    // Another tenant's assignments never touch this one.
    const plain = await createTenant(db, `Plain tenant ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('tenants').where({ tenant: plain }).update({ licensed_user_count: 3 });
    for (let seat = 0; seat < 2; seat += 1) await createUser(db, plain, { user_type: 'internal' });
    await createUser(db, plain, { user_type: 'internal', is_inactive: true });
    await createUser(db, plain, { user_type: 'client' });
    await db('user_invitations').insert({ tenant: plain, email: address(), first_name: 'P', last_name: 'I', role_id: null,
      token: randomUUID(), expires_at: new Date(Date.now() + DAY) });
    // Room on the limit: the appliance seat check sees the same count as every other site.
    await db('tenants').where({ tenant: plain }).update({ licensed_user_count: 5 });
    expect((await licenceReadings(plain)).applianceUsedSeats).toEqual([2]);
    await db('tenants').where({ tenant: plain }).update({ licensed_user_count: 3 });
    expect(await licenceReadings(plain)).toMatchObject({ licensedUsers: await activeInternalUsers(plain),
      usage: { limit: 3, used: 2, remaining: 1 }, onboardingUsed: 3, pendingInvitations: 1, seatGuard: { ok: true } });
  });
});
