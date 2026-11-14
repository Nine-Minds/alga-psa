/**
 * Co-managed seat and workspace shapes, slice S38 (F091, F092, F095 / T048, T049) on real Postgres.
 *
 * Ending an arrangement deactivates its technicians, releases its allocation once, hands its tickets
 * back to the MSP and leaves shared notes readable to MSP staff; a replay changes nothing. After the
 * pool's lapse grace a seat technician's mutations are refused with the lifecycle error while their
 * reads still work, and an MSP user and a requester are unaffected. A technician comes back only into
 * a live assignment that has a seat.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  BuiltinAuthorizationKernelProvider, createAuthorizationKernel, resetMutationAdmissionGate,
} from '@alga-psa/authorization/kernel';
import {
  createCoManagedSeatArrangement, endCoManagedSeatArrangement, handCoManagedSeatTicketToClientIt, inviteCoManagedSeatTechnician,
  previewCoManagedSeatArrangementEnd, readCoManagedSeatTicketWork, setCoManagedSeatBoardScope,
} from '@alga-psa/co-managed';
import { authorizeTicketRecordAccess } from '@alga-psa/authorization/ticketRecordAuthorization';
import { registerCoManagedSeatWriteAdmission } from '@alga-psa/co-managed/seatWriteAdmission';
import { getCoManagedEntitlementState } from '@alga-psa/licensing';
import { isCoManagedLifecycleError } from '@alga-psa/licensing/lifecycle-error';
import { admitInternalUserSeat } from '../../../../packages/users/src/lib/internalUserLicenseGuard';
import Comment from '../../../../packages/tickets/src/models/comment';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

vi.mock('@enterprise/lib/license/userSeatGuard', () => ({ checkApplianceLicenseSeatLimit: async () => null }));

const DAY = 86_400_000;
const describeDb = await describeWithDb();

describeDb('ending a seat arrangement and lapse', { shuffle: false }, () => {
  let db: Knex;
  let ticketNumber = 0;

  /** A sponsor with an arranged client (3 seats, one board in scope), MSP staff and two active technicians. */
  const world = async (seats = 3) => {
    const sponsor = await createTenant(db, `End sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('co_managed_entitlements').insert({ tenant: sponsor, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 10,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    const clientId = await createClient(db, sponsor, `End client ${randomUUID().slice(0, 8)}`);
    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: sponsor, clientId, operationId: randomUUID(), seats });
    const boardId = randomUUID();
    await db('boards').insert({ tenant: sponsor, board_id: boardId, board_name: `Board ${boardId.slice(0, 8)}`, is_default: false });
    await setCoManagedSeatBoardScope(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id, boards: [{ boardId, canCreate: true }] });
    const staff = await createUser(db, sponsor);
    const technicians = [await seat(sponsor, arrangement.arrangement_id), await seat(sponsor, arrangement.arrangement_id)];
    return { sponsor, clientId, arrangementId: arrangement.arrangement_id, allocationId: arrangement.allocation_id, boardId, staff, technicians };
  };
  type World = Awaited<ReturnType<typeof world>>;

  const seat = async (tenant: string, arrangementId: string, state: 'active' | 'revoked' = 'active') => {
    const userId = await createUser(db, tenant, { user_type: 'internal' });
    await db('co_managed_seat_assignments').insert({ tenant, assignment_id: randomUUID(), arrangement_id: arrangementId,
      user_id: userId, state, revoked_at: state === 'revoked' ? new Date() : null });
    return userId;
  };
  const ticket = async (w: World, assignedTo: string | null = null) => {
    const ticketId = randomUUID();
    await db('tickets').insert({ tenant: w.sponsor, ticket_id: ticketId, ticket_number: `S38-${++ticketNumber}`, title: 'Seat ticket',
      client_id: w.clientId, board_id: w.boardId, assigned_to: assignedTo, entered_at: new Date(), updated_at: new Date() });
    return ticketId;
  };
  const toClientIt = (w: World, ticketId: string, technicianUserId?: string) => handCoManagedSeatTicketToClientIt(db, {
    sponsorTenant: w.sponsor, ticketId, actorUserId: w.staff, operationId: randomUUID(), expectedRevision: 0,
    note: 'Over to your team.', technicianUserId });
  const end = (w: World) => endCoManagedSeatArrangement(db, { sponsorTenant: w.sponsor, arrangementId: w.arrangementId, actorUserId: w.staff });
  const admit = (sponsor: string, userId: string) => db.transaction((trx) => admitInternalUserSeat(trx, sponsor, { kind: 'user', existingUserId: userId }));

  beforeAll(async () => { db = await createTestDbConnection({ databaseName: 's38_end_arrangement_and_lapse_test' }); }, 300_000);
  afterAll(async () => { resetMutationAdmissionGate(); await db?.destroy(); });

  // T048 / F091, F095
  it('ends an arrangement once, returns responsibility, keeps shared notes readable, and refuses a reactivation without a live assignment', async () => {
    const w = await world();
    const [first, second] = w.technicians;
    const handed = [await ticket(w), await ticket(w, first)];
    for (const ticketId of handed) await toClientIt(w, ticketId, ticketId === handed[1] ? first : undefined);
    const mspHeld = await ticket(w, second);
    // A shared IT note written by a technician, while the arrangement is live.
    const noteId = await Comment.insert(db, w.sponsor, { ticket_id: handed[0], user_id: first, author_type: 'internal', is_internal: true,
      collaboration_audience: 'shared_it', is_resolution: false, note: 'Shared with both teams', markdown_content: 'Shared with both teams' } as any,
      undefined, { kind: 'seat', tenant: w.sponsor, clientId: w.clientId });

    const preview = await previewCoManagedSeatArrangementEnd(db, { sponsorTenant: w.sponsor, arrangementId: w.arrangementId });
    expect(preview).toMatchObject({ state: 'active', technicians: 2, ticketsWithClientIt: 2, seatsToRelease: 3 });
    expect(preview.clientName).toMatch(/^End client /);

    expect(await end(w)).toEqual({ arrangementId: w.arrangementId, ended: true, releasedSeats: 3, deactivatedTechnicians: 2, ticketsReturned: 3 });

    // Technicians deactivated.
    expect(await db('users').where({ tenant: w.sponsor }).whereIn('user_id', w.technicians).select('is_inactive')).toEqual([{ is_inactive: true }, { is_inactive: true }]);
    expect((await db('users').where({ tenant: w.sponsor, user_id: w.staff }).first('is_inactive')).is_inactive).toBe(false);
    // The allocation released exactly once, at the row.
    const allocation = await db('co_managed_allocations').where({ tenant: w.sponsor, allocation_id: w.allocationId }).first();
    expect(allocation.state).toBe('released');
    expect(allocation.released_at).not.toBeNull();
    expect((await getCoManagedEntitlementState(db, w.sponsor)).allocated).toBe(0);
    expect(await db('co_managed_seat_arrangements').where({ tenant: w.sponsor, arrangement_id: w.arrangementId }).first('state', 'ended_at'))
      .toMatchObject({ state: 'ended', ended_at: expect.any(Date) });
    // Responsibility is the MSP's, by recorded transitions, and no technician is left assigned.
    for (const ticketId of handed) expect(await db('co_managed_seat_ticket_work').where({ tenant: w.sponsor, ticket_id: ticketId }).first())
      .toMatchObject({ responsibility: 'msp', revision: expect.any(Number) });
    const receipts = await db('co_managed_seat_ticket_handoffs').where({ tenant: w.sponsor, arrangement_id: w.arrangementId, to_responsibility: 'msp' });
    expect(receipts).toHaveLength(2);
    for (const receipt of receipts) expect(receipt).toMatchObject({ from_responsibility: 'client_it', to_responsibility: 'msp', actor_user_id: w.staff });
    for (const ticketId of [...handed, mspHeld]) {
      expect((await db('tickets').where({ tenant: w.sponsor, ticket_id: ticketId }).first('assigned_to')).assigned_to, ticketId).toBeNull();
    }
    expect(await readCoManagedSeatTicketWork(db, { sponsorTenant: w.sponsor, ticketId: handed[0] })).toBeNull();
    // The shared note is still readable by MSP staff, through the real comment read path.
    const staffRead = await Comment.getAllbyTicketId(db, w.sponsor, handed[0], w.staff);
    expect(staffRead.map((comment) => comment.comment_id)).toContain(noteId);

    // A replay changes nothing and does not fail.
    const rows = async () => ({
      allocation: await db('co_managed_allocations').where({ tenant: w.sponsor, allocation_id: w.allocationId }).first(),
      arrangement: await db('co_managed_seat_arrangements').where({ tenant: w.sponsor, arrangement_id: w.arrangementId }).first(),
      receipts: await db('co_managed_seat_ticket_handoffs').where({ tenant: w.sponsor }).orderBy('operation_id'),
      work: await db('co_managed_seat_ticket_work').where({ tenant: w.sponsor }).orderBy('ticket_id'),
      users: await db('users').where({ tenant: w.sponsor }).orderBy('user_id'),
      tickets: await db('tickets').where({ tenant: w.sponsor }).orderBy('ticket_id'),
    });
    const before = await rows();
    expect(await end(w)).toEqual({ arrangementId: w.arrangementId, ended: false, releasedSeats: 0, deactivatedTechnicians: 0, ticketsReturned: 0 });
    expect(await rows()).toEqual(before);

    // A technician of the ended arrangement is refused on every reactivation path's one admission.
    expect(await admit(w.sponsor, first)).toMatchObject({ ok: false, code: 'SEAT_ARRANGEMENT_REFUSED', error: 'This seat arrangement has ended.' });
    // A technician with no live assignment at all is not a seat technician: S9 admits them as the MSP's own
    // user (a deliberate conversion), and an ordinary inactive MSP user is reactivated against the MSP's licence.
    const roomOnTheMspLicence = await createTenant(db, `Licence room ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('tenants').where({ tenant: roomOnTheMspLicence }).update({ licensed_user_count: 50, plan: 'pro' });
    // An ordinary inactive MSP user is still reactivated against the MSP's licence.
    const ordinary = await createUser(db, roomOnTheMspLicence, { user_type: 'internal', is_inactive: true });
    expect(await admit(roomOnTheMspLicence, ordinary)).toEqual({ ok: true });
  });

  // F095 positive case
  it('reactivates a deactivated technician who still holds a live assignment with a seat', async () => {
    const w = await world(2);
    const [technician] = w.technicians;
    await db('users').where({ tenant: w.sponsor, user_id: technician }).update({ is_inactive: true });
    expect(await admit(w.sponsor, technician)).toEqual({ ok: true, seatTechnician: true });
    // The seat shrank below what the arrangement commits: refused, not admitted past the allocation.
    await db('co_managed_allocations').where({ tenant: w.sponsor, allocation_id: w.allocationId }).update({ seats: 1 });
    expect(await admit(w.sponsor, technician)).toMatchObject({ ok: false, code: 'SEAT_ARRANGEMENT_REFUSED' });
  });

  it('an arrangement that does not exist is refused, and unaccepted invitations are withdrawn', async () => {
    const w = await world();
    const invitation = await inviteCoManagedSeatTechnician(db, { sponsorTenant: w.sponsor, arrangementId: w.arrangementId,
      email: `invitee.${randomUUID().slice(0, 8)}@client.example`, firstName: 'Ira' });
    await end(w);
    expect((await db('user_invitations').where({ tenant: w.sponsor, invitation_id: invitation.invitation_id }).first(db.raw('expires_at <= now() as expired'))).expired).toBe(true);
    await expect(endCoManagedSeatArrangement(db, { sponsorTenant: w.sponsor, arrangementId: randomUUID(), actorUserId: w.staff }))
      .rejects.toMatchObject({ code: 'ARRANGEMENT_NOT_FOUND' });
  });

  // T049 / F092
  it('refuses a seat technician\'s writes after grace, with reads, an MSP user and a requester unaffected', async () => {
    registerCoManagedSeatWriteAdmission();
    const w = await world();
    const [technician] = w.technicians;
    const ticketId = await ticket(w);
    const kernel = createAuthorizationKernel({ builtinProvider: new BuiltinAuthorizationKernelProvider(), rbacEvaluator: async () => true });
    const as = (userId: string, userType: 'internal' | 'client') => ({
      subject: { tenant: w.sponsor, userId, userType, roleIds: [] as string[], clientId: userType === 'client' ? w.clientId : null },
      record: { id: ticketId, clientId: w.clientId },
      resource: { type: 'ticket', action: 'update' }, mutation: { kind: 'update' }, knex: db,
    });
    const lapse = (daysAgo: number | null) => db('co_managed_entitlements').where({ tenant: w.sponsor })
      .update(daysAgo === null ? { lapse_started_at: null, read_only_after: null }
        : { lapse_started_at: new Date(Date.now() - daysAgo * DAY), read_only_after: new Date(Date.now() + (30 - daysAgo) * DAY) });
    const refused = async (userId: string) => kernel.authorizeMutation(as(userId, 'internal')).then(() => null, (error) => error);

    // Healthy pool, and inside grace: the technician writes.
    expect((await kernel.authorizeMutation(as(technician, 'internal'))).allowed).toBe(true);
    await lapse(10);
    expect((await kernel.authorizeMutation(as(technician, 'internal'))).allowed).toBe(true);

    // Grace expired.
    await lapse(31);
    const error = await refused(technician);
    expect(isCoManagedLifecycleError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'CO_MANAGED_READ_ONLY', lifecycle: { state: 'read_only', canWrite: false } });
    // The same technician reads.
    expect((await kernel.authorizeResource({ ...as(technician, 'internal'), resource: { type: 'ticket', action: 'read' }, mutation: undefined })).allowed).toBe(true);
    // An MSP user and a requester on the same ticket write.
    expect((await kernel.authorizeMutation(as(w.staff, 'internal'))).allowed).toBe(true);
    expect((await kernel.authorizeMutation(as(randomUUID(), 'client'))).allowed).toBe(true);

    // The real ticket write path, on the same ticket, in the same expired-grace state.
    const contactId = randomUUID();
    await db('contacts').insert({ tenant: w.sponsor, contact_name_id: contactId, full_name: 'Rita Requester',
      email: `rita-${contactId}@example.com`, client_id: w.clientId });
    await db('tickets').where({ tenant: w.sponsor, ticket_id: ticketId }).update({ contact_name_id: contactId });
    const requesterUser = await createUser(db, w.sponsor, { user_type: 'client', contact_id: contactId });
    const principal = (userId: string, userType: 'internal' | 'client', extra: Record<string, unknown> = {}) =>
      ({ user_id: userId, tenant: w.sponsor, user_type: userType, roles: [], ...extra }) as any;
    const ticketAccess = (user: any, action: 'read' | 'update') =>
      db.transaction((trx) => authorizeTicketRecordAccess({ trx, tenant: w.sponsor, user, ticketId, action }));
    const technicianUser = principal(technician, 'internal');
    const writeError = await ticketAccess(technicianUser, 'update').then(() => null, (e) => e);
    expect(isCoManagedLifecycleError(writeError)).toBe(true);
    await expect(ticketAccess(technicianUser, 'read')).resolves.toMatchObject({ ticket_id: ticketId });
    await expect(ticketAccess(principal(w.staff, 'internal'), 'update')).resolves.toMatchObject({ ticket_id: ticketId });
    await expect(ticketAccess(principal(requesterUser, 'client', { contact_id: contactId }), 'update')).resolves.toMatchObject({ ticket_id: ticketId });

    // Renewal clears the lapse and the technician writes again; an ended arrangement refuses them for good.
    await lapse(null);
    expect((await kernel.authorizeMutation(as(technician, 'internal'))).allowed).toBe(true);
    await end(w);
    expect(isCoManagedLifecycleError(await refused(technician))).toBe(true);
    expect((await kernel.authorizeMutation(as(w.staff, 'internal'))).allowed).toBe(true);
  });

  it('does not lock out an MSP user whose only seat assignment is revoked', async () => {
    registerCoManagedSeatWriteAdmission();
    const w = await world();
    const converted = await seat(w.sponsor, w.arrangementId, 'revoked');
    await db('co_managed_entitlements').where({ tenant: w.sponsor })
      .update({ lapse_started_at: new Date(Date.now() - 31 * DAY), read_only_after: new Date(Date.now() - DAY) });
    const kernel = createAuthorizationKernel({ builtinProvider: new BuiltinAuthorizationKernelProvider(), rbacEvaluator: async () => true });
    const write = (userId: string) => kernel.authorizeMutation({ subject: { tenant: w.sponsor, userId, userType: 'internal', roleIds: [] },
      resource: { type: 'ticket', action: 'update' }, mutation: { kind: 'update' }, knex: db });
    expect((await write(converted)).allowed).toBe(true);
    await expect(write(w.technicians[0])).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
  });
});
