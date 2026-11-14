/**
 * Co-managed seat and workspace shapes, slice S7 (F016, F017, F025 / T009, T010) on real Postgres.
 *
 * A seat technician is invited by name and email into a client's seat arrangement. The invitation
 * is an `invited` assignment that holds one of the arrangement's seats. An email that is already
 * an internal user anywhere on the platform is refused with that reason, an invitation past the
 * allocation is refused, and concurrent invitations for the last seat admit exactly one. Seat
 * admission orders its locks (seat lock, entitlement, allocation, arrangement) so that it cannot
 * deadlock against reservation, purchase or hosted reconcile.
 */
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  coManagedSeatCommitmentCounter, createCoManagedSeatArrangement, inviteCoManagedSeatTechnician, setCoManagedSeatBoardScope,
} from '@alga-psa/co-managed';
import {
  reconcileHostedCoManagedEntitlement, releaseCoManagedSeatAllocation, reserveAndActivateCoManagedSeatAllocation,
  resizeCoManagedSeatAllocation, runCoManagedPurchase,
} from '@alga-psa/licensing';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const DAY = 86_400_000;
const describeDb = await describeWithDb();

describeDb('inviting a seat technician against the allocation', { shuffle: false }, () => {
  let db: Knex;

  const sponsorWithPool = async (capacity: number, subscription = `sub_${randomUUID()}`) => {
    const sponsor = await createTenant(db, `Seat sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('co_managed_entitlements').insert({ tenant: sponsor, source: 'hosted', source_reference: subscription, capacity,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    return sponsor;
  };
  const client = (sponsor: string) => createClient(db, sponsor, `Seat client ${randomUUID().slice(0, 8)}`);
  const arrange = async (sponsorTenant: string, seats: number) =>
    createCoManagedSeatArrangement(db, { sponsorTenant, clientId: await client(sponsorTenant), operationId: randomUUID(), seats });
  const address = (label = 'tech') => `${label}.${randomUUID().slice(0, 12)}@client.example`;
  const invite = (sponsorTenant: string, arrangementId: string, email: string = address(), firstName = 'Dana', lastName = 'Reyes') =>
    inviteCoManagedSeatTechnician(db, { sponsorTenant, arrangementId, email, firstName, lastName });
  const assignments = (sponsor: string) => db('co_managed_seat_assignments').where({ tenant: sponsor }).orderBy('created_at');
  const invitations = (sponsor: string) => db('user_invitations').where({ tenant: sponsor }).orderBy('created_at');
  const codes = (results: PromiseSettledResult<unknown>[]) =>
    results.flatMap((result) => result.status === 'rejected' ? [result.reason?.code ?? String(result.reason)] : []);

  /** Backends of this database currently waiting on a lock. */
  const waitForBlockedBackends = async (count: number, timeoutMs = 20_000) => {
    const start = Date.now();
    let seen = 0;
    while (Date.now() - start < timeoutMs) {
      const result = await db.raw(`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`);
      seen = result.rows[0].n;
      if (seen >= count) return seen;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`only ${seen}/${count} backends blocked before timeout`);
  };

  /**
   * Holds a lock in its own transaction while `race` starts, lets go once `waiting` backends are
   * queued behind it, and returns how the race settled. Every racer is in flight at once.
   */
  const pileUpBehind = async <T>(lock: (trx: Knex.Transaction) => Promise<unknown>, waiting: number, race: () => Promise<T>[]) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => { locked = resolve; });
    const blocker = db.transaction(async (trx) => { await lock(trx); locked(); await held; });
    await acquired;
    const racers = race();
    try { await waitForBlockedBackends(waiting); } finally { release(); }
    await blocker;
    return Promise.allSettled(racers);
  };
  const poolLock = (sponsor: string) => (trx: Knex.Transaction) =>
    trx('co_managed_entitlements').where({ tenant: sponsor }).forUpdate().first('tenant');

  /** Fails rather than hangs: a deadlock Postgres did not report would otherwise stall the suite. */
  const within = <T>(ms: number, work: Promise<T>): Promise<T> => Promise.race([
    work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`did not complete within ${ms}ms`)), ms)),
  ]);
  const deadlocks = async () => {
    // The statistics are flushed asynchronously; ask for a fresh snapshot.
    await db.raw('SELECT pg_stat_clear_snapshot()');
    const result = await db.raw('SELECT deadlocks::int AS n FROM pg_stat_database WHERE datname = current_database()');
    return result.rows[0].n as number;
  };

  beforeAll(async () => { db = await createTestDbConnection({ databaseName: 's7_seat_invitation_test' }); }, 300_000);
  afterAll(async () => { await db?.destroy(); });

  // F016
  it('records the technician as invited, by name and email, and the invitation holds a seat', async () => {
    const sponsor = await sponsorWithPool(10);
    const arrangement = await arrange(sponsor, 2);
    const invitedBy = await createUser(db, sponsor, { user_type: 'internal' });

    const invitation = await inviteCoManagedSeatTechnician(db, { sponsorTenant: sponsor,
      arrangementId: arrangement.arrangement_id, email: '  Dana.Reyes@Client.Example ', firstName: ' Dana ', lastName: 'Reyes', invitedBy });

    expect(invitation).toEqual({ assignment_id: expect.any(String), arrangement_id: arrangement.arrangement_id,
      invitation_id: expect.any(String), email: 'dana.reyes@client.example', state: 'invited',
      token: expect.stringMatching(/^[0-9a-f]{64}$/), created: true });
    expect(await assignments(sponsor)).toEqual([expect.objectContaining({ assignment_id: invitation.assignment_id,
      arrangement_id: arrangement.arrangement_id, invitation_id: invitation.invitation_id, user_id: null,
      state: 'invited', revoked_at: null })]);
    const [row] = await invitations(sponsor);
    expect(row).toMatchObject({ invitation_id: invitation.invitation_id, email: 'dana.reyes@client.example',
      first_name: 'Dana', last_name: 'Reyes', role_id: null, used_at: null, token: invitation.token,
      metadata: { co_managed_seat_assignment_id: invitation.assignment_id,
        co_managed_seat_arrangement_id: arrangement.arrangement_id, created_by: invitedBy } });
    expect(new Date(row.expires_at).getTime()).toBeGreaterThan(Date.now());

    // Committed: the allocation cannot be resized below the invitation, and one seat is left.
    const countCommittedSeats = coManagedSeatCommitmentCounter(sponsor);
    await expect(resizeCoManagedSeatAllocation(db, sponsor, { allocationId: arrangement.allocation_id,
      seats: 1, expectedSeats: 2, countCommittedSeats })).resolves.toBeUndefined();
    await invite(sponsor, (await arrange(sponsor, 3)).arrangement_id);
    const other = (await db('co_managed_seat_arrangements').where({ tenant: sponsor }).orderBy('created_at'))[1];
    await invite(sponsor, other.arrangement_id);
    await expect(resizeCoManagedSeatAllocation(db, sponsor, { allocationId: other.allocation_id,
      seats: 1, expectedSeats: 3, countCommittedSeats })).rejects.toMatchObject({ code: 'CO_MANAGED_SEAT_LIMIT' });
    await expect(resizeCoManagedSeatAllocation(db, sponsor, { allocationId: other.allocation_id,
      seats: 2, expectedSeats: 3, countCommittedSeats })).resolves.toBeUndefined();
  });

  // F016
  it('inviting the same technician again returns the same invitation and takes no further seat', async () => {
    const sponsor = await sponsorWithPool(10);
    const arrangement = await arrange(sponsor, 1);
    const elsewhere = await arrange(sponsor, 1);
    const email = address();

    const first = await invite(sponsor, arrangement.arrangement_id, email);
    const again = await invite(sponsor, arrangement.arrangement_id, email.toUpperCase(), 'Renamed', 'Later');

    expect(again).toEqual({ ...first, created: false });
    expect(await assignments(sponsor)).toHaveLength(1);
    expect(await invitations(sponsor)).toEqual([expect.objectContaining({ first_name: 'Dana', last_name: 'Reyes' })]);
    // Still held once its link has expired: an invitation keeps its seat until accepted or revoked.
    await db('user_invitations').where({ tenant: sponsor }).update({ expires_at: new Date(Date.now() - DAY) });
    expect(await invite(sponsor, arrangement.arrangement_id, email)).toEqual({ ...first, created: false });
    await expect(invite(sponsor, arrangement.arrangement_id)).rejects.toMatchObject({ code: 'SEAT_LIMIT' });
    // One technician, one arrangement.
    await expect(invite(sponsor, elsewhere.arrangement_id, email)).rejects.toMatchObject({ code: 'EMAIL_INVITED' });
    expect(await assignments(sponsor)).toHaveLength(1);
  });

  // T009 / F016
  it("refuses an email claimed by another tenant's internal user, with that reason, and writes nothing", async () => {
    const sponsor = await sponsorWithPool(10);
    const arrangement = await arrange(sponsor, 3);
    const otherTenant = await createTenant(db, `Other MSP ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    const claimed = address('claimed');
    await createUser(db, otherTenant, { email: claimed.toUpperCase(), user_type: 'internal' });
    const own = address('own');
    await createUser(db, sponsor, { email: own, user_type: 'internal' });

    const refusal = await invite(sponsor, arrangement.arrangement_id, claimed).catch((error) => error);
    expect(refusal).toMatchObject({ name: 'CoManagedSeatInvitationError', code: 'EMAIL_IN_USE',
      message: 'This email address already belongs to a user account. Use a different address.' });
    // The sponsor's own staff are internal users too.
    await expect(invite(sponsor, arrangement.arrangement_id, own)).rejects.toMatchObject({ code: 'EMAIL_IN_USE' });

    expect(await assignments(sponsor)).toEqual([]);
    expect(await invitations(sponsor)).toEqual([]);

    // A client-portal user or an inactive-elsewhere address is not an internal claim.
    const portal = address('portal');
    await createUser(db, otherTenant, { email: portal, user_type: 'client' });
    await expect(invite(sponsor, arrangement.arrangement_id, portal)).resolves.toMatchObject({ created: true });
  });

  // F016
  it('refuses an email already promised to a pending team invitation, here or in another tenant', async () => {
    const sponsor = await sponsorWithPool(10);
    const arrangement = await arrange(sponsor, 3);
    const otherTenant = await createTenant(db, `Other MSP ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    const pending = (tenant: string, email: string, expiresAt: Date) => db('user_invitations').insert({ tenant, email,
      first_name: 'Team', last_name: 'Member', role_id: randomUUID(), token: randomUUID(), expires_at: expiresAt });
    const [here, there, lapsed] = [address('here'), address('there'), address('lapsed')];
    await pending(sponsor, here, new Date(Date.now() + DAY));
    await pending(otherTenant, there, new Date(Date.now() + DAY));
    await pending(otherTenant, lapsed, new Date(Date.now() - DAY));

    await expect(invite(sponsor, arrangement.arrangement_id, here)).rejects.toMatchObject({ code: 'EMAIL_INVITED' });
    await expect(invite(sponsor, arrangement.arrangement_id, there)).rejects.toMatchObject({ code: 'EMAIL_INVITED' });
    expect(await assignments(sponsor)).toEqual([]);
    // An expired invitation promises nothing.
    await expect(invite(sponsor, arrangement.arrangement_id, lapsed)).resolves.toMatchObject({ created: true });
  });

  // F016
  it('refuses a malformed request, an unknown or ended arrangement and a lapsed pool, each by name', async () => {
    const sponsor = await sponsorWithPool(10);
    const arrangement = await arrange(sponsor, 3);
    const request = { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id, email: address(), firstName: 'Dana' };

    for (const bad of [{ email: 'not-an-email' }, { email: '' }, { firstName: '  ' }, { arrangementId: 'nope' },
      { sponsorTenant: 'nope' }, { invitedBy: 'nope' }]) {
      await expect(inviteCoManagedSeatTechnician(db, { ...request, ...bad })).rejects.toMatchObject({ code: 'INVALID_INVITATION' });
    }
    await expect(invite(sponsor, randomUUID())).rejects.toMatchObject({ code: 'ARRANGEMENT_NOT_FOUND' });
    // Another sponsor's arrangement is not this sponsor's to invite into.
    await expect(invite(await sponsorWithPool(5), arrangement.arrangement_id)).rejects.toMatchObject({ code: 'ARRANGEMENT_NOT_FOUND' });

    // Lapse grace: no new technicians, as for every other seat admission.
    await db('co_managed_entitlements').where({ tenant: sponsor }).update({ valid_until: new Date(Date.now() - DAY) });
    await expect(invite(sponsor, arrangement.arrangement_id)).rejects.toMatchObject({ code: 'ENTITLEMENT_LAPSED' });
    await db('co_managed_entitlements').where({ tenant: sponsor })
      .update({ valid_until: new Date(Date.now() + 365 * DAY), lapse_started_at: null });
    // A last name is optional.
    await expect(inviteCoManagedSeatTechnician(db, request)).resolves.toMatchObject({ created: true });

    const released = await arrange(sponsor, 1);
    await releaseCoManagedSeatAllocation(db, sponsor, { allocationId: released.allocation_id });
    await expect(invite(sponsor, released.arrangement_id)).rejects.toMatchObject({ code: 'ARRANGEMENT_ENDED' });
    await db('co_managed_seat_arrangements').where({ tenant: sponsor, arrangement_id: arrangement.arrangement_id })
      .update({ state: 'ended', ended_at: new Date() });
    await expect(invite(sponsor, arrangement.arrangement_id)).rejects.toMatchObject({ code: 'ARRANGEMENT_ENDED' });

    expect(await assignments(sponsor)).toHaveLength(1);
  });

  // F017
  it('refuses an invitation once committed seats equal the allocation, and admits again after a raise', async () => {
    const sponsor = await sponsorWithPool(10);
    const arrangement = await arrange(sponsor, 2);
    await invite(sponsor, arrangement.arrangement_id);
    const technician = await createUser(db, sponsor, { user_type: 'internal' });
    // An active technician and a pending invitation each hold a seat; a revoked one holds none.
    await db.transaction((trx) => retainBuiltinResolverSubject(trx, { tenant: sponsor, userId: technician }, CO_MANAGED_SEAT_RESOLVER_ID));
    await db('co_managed_seat_assignments').insert([
      { tenant: sponsor, assignment_id: randomUUID(), arrangement_id: arrangement.arrangement_id, user_id: technician, state: 'active' },
      { tenant: sponsor, assignment_id: randomUUID(), arrangement_id: arrangement.arrangement_id, state: 'revoked', revoked_at: new Date() },
    ]);

    const refusal = await invite(sponsor, arrangement.arrangement_id).catch((error) => error);
    expect(refusal).toMatchObject({ name: 'CoManagedSeatInvitationError', code: 'SEAT_LIMIT' });
    expect(await invitations(sponsor)).toHaveLength(1);

    await resizeCoManagedSeatAllocation(db, sponsor, { allocationId: arrangement.allocation_id, seats: 3, expectedSeats: 2,
      countCommittedSeats: coManagedSeatCommitmentCounter(sponsor) });
    await expect(invite(sponsor, arrangement.arrangement_id)).resolves.toMatchObject({ created: true });
    await expect(invite(sponsor, arrangement.arrangement_id)).rejects.toMatchObject({ code: 'SEAT_LIMIT' });
    // Another arrangement's seats are its own.
    await expect(invite(sponsor, (await arrange(sponsor, 1)).arrangement_id)).resolves.toMatchObject({ created: true });
  });

  // T009 / F017
  it('eight concurrent invitations for the last seat admit exactly one', async () => {
    const sponsor = await sponsorWithPool(10);
    const arrangement = await arrange(sponsor, 3);
    await invite(sponsor, arrangement.arrangement_id);
    await invite(sponsor, arrangement.arrangement_id);

    // All eight are in flight before any may proceed: one waits on the pool, seven behind it.
    const results = await within(60_000, pileUpBehind(poolLock(sponsor), 8,
      () => Array.from({ length: 8 }, () => invite(sponsor, arrangement.arrangement_id))));

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(codes(results)).toEqual(Array(7).fill('SEAT_LIMIT'));
    expect(await assignments(sponsor)).toHaveLength(3);
    expect(await invitations(sponsor)).toHaveLength(3);
  }, 90_000);

  // F016 / F017
  it('eight concurrent invitations of one technician produce one invitation and one seat', async () => {
    const sponsor = await sponsorWithPool(10);
    const arrangement = await arrange(sponsor, 5);
    const email = address();

    const results = await within(60_000, pileUpBehind(poolLock(sponsor), 8,
      () => Array.from({ length: 8 }, () => invite(sponsor, arrangement.arrangement_id, email))));

    expect(codes(results)).toEqual([]);
    const settled = results.map((result) => (result as PromiseFulfilledResult<Awaited<ReturnType<typeof invite>>>).value);
    expect(settled.filter((invitation) => invitation.created)).toHaveLength(1);
    expect(new Set(settled.map((invitation) => invitation.assignment_id)).size).toBe(1);
    expect(await assignments(sponsor)).toHaveLength(1);
    expect(await invitations(sponsor)).toHaveLength(1);
  }, 90_000);

  // F025
  it("takes the tenant's internal-user seat lock first, the one every internal-user seat path takes", async () => {
    const sponsor = await sponsorWithPool(10);
    const arrangement = await arrange(sponsor, 2);
    const untouched = await sponsorWithPool(10);
    const other = await arrange(untouched, 2);
    const seatLock = (trx: Knex.Transaction) =>
      trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))', ['internal_user_seats', sponsor]);

    let otherTenantAdmitted = false;
    const results = await within(60_000, pileUpBehind(seatLock, 1, () => [
      invite(sponsor, arrangement.arrangement_id),
      // Per tenant: another sponsor's invitation does not queue behind this one's lock.
      invite(untouched, other.arrangement_id).then((invitation) => { otherTenantAdmitted = true; return invitation; }),
    ]));

    expect(codes(results)).toEqual([]);
    expect(otherTenantAdmitted).toBe(true);
    expect(await assignments(sponsor)).toHaveLength(1);
  }, 90_000);

  // T010 / F025
  it('seat admission racing reservation, purchase and hosted reconcile completes without deadlock', async () => {
    const CAPACITY = 200;
    const subscription = `sub_${randomUUID()}`;
    const sponsor = await sponsorWithPool(CAPACITY, subscription);
    const arrangement = await arrange(sponsor, 60);
    const countCommittedSeats = coManagedSeatCommitmentCounter(sponsor);
    const before = await deadlocks();
    let seats = 60;
    let spare = await arrange(sponsor, 1);

    /** One of every command that touches the pool or the arrangement, all at once. */
    const round = (index: number) => {
      const resized = seats + (index % 2 === 0 ? 1 : -1);
      const releasing = spare;
      const commands: Array<[string, () => Promise<unknown>]> = [
        ['invite', () => invite(sponsor, arrangement.arrangement_id)],
        ['invite', () => invite(sponsor, arrangement.arrangement_id)],
        ['invite', () => invite(sponsor, arrangement.arrangement_id)],
        ['arrangement', async () => { spare = await arrange(sponsor, 1); }],
        ['reservation', async () => reserveAndActivateCoManagedSeatAllocation(db, { sponsorTenant: sponsor,
          clientId: await client(sponsor), operationId: randomUUID(), seats: 1 })],
        ['purchase', () => runCoManagedPurchase(db, { sponsorTenant: sponsor, operationId: randomUUID(), quantity: CAPACITY },
          async () => ({ kind: 'updated', subscriptionId: subscription }))],
        ['reconcile', () => reconcileHostedCoManagedEntitlement(db, sponsor, subscription,
          async () => ({ capacity: CAPACITY, validUntil: new Date(Date.now() + 365 * DAY), active: true }))],
        ['resize', async () => {
          await resizeCoManagedSeatAllocation(db, sponsor, { allocationId: arrangement.allocation_id, seats: resized,
            expectedSeats: seats, countCommittedSeats });
          seats = resized;
        }],
        ['release', () => releaseCoManagedSeatAllocation(db, sponsor, { allocationId: releasing.allocation_id })],
        ['board scope', () => setCoManagedSeatBoardScope(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id, boards: [] })],
      ];
      // A different starting order each round, so no command is always first to the pool.
      const order = commands.map((_, at) => commands[(at * 7 + index * 3) % commands.length]);
      return { names: order.map(([name]) => name), start: () => order.map(([, run]) => run()) };
    };
    const failures = (names: string[], results: PromiseSettledResult<unknown>[]) => results.flatMap((result, at) =>
      result.status === 'rejected' ? [`${names[at]}: ${result.reason?.code ?? ''} ${result.reason?.message ?? result.reason}`] : []);

    // Free-running rounds: the commands interleave however the scheduler lets them.
    for (let index = 0; index < 12; index += 1) {
      const { names, start } = round(index);
      expect(failures(names, await within(60_000, Promise.allSettled(start()))), `round ${index}`).toEqual([]);
    }
    // Forced contention: every command is started while the pool is held, so all of them are
    // queued on their first contended lock at the same moment, then released together.
    for (let index = 12; index < 18; index += 1) {
      const { names, start } = round(index);
      // Nine wait on the pool or the seat lock; board scope takes neither and runs straight through.
      const results = await within(60_000, pileUpBehind(poolLock(sponsor), 9, start));
      expect(failures(names, results), `round ${index}`).toEqual([]);
    }

    expect(await deadlocks()).toBe(before);
    // Nothing was lost on the way: every invitation of every round holds its seat.
    expect(await assignments(sponsor)).toHaveLength(18 * 3);
    expect(await db('co_managed_seat_assignments').where({ tenant: sponsor, state: 'invited' })
      .countDistinct('invitation_id as n').first()).toMatchObject({ n: String(18 * 3) });
  }, 300_000);
});
