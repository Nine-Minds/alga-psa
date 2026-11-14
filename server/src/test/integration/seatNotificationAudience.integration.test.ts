import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant, tenantDb } from '@alga-psa/db';
import { TicketModel } from '@alga-psa/shared/models/ticketModel';
import {
  addTicketWatcher, addTicketWatcherRecipients, setTicketWatcherActive,
} from '@alga-psa/shared/services/tickets/ticketWatcherService';
import {
  recipientInScope, recipientRendering, resolveInboundReplyAudience, resolveTicketNotificationRecipient,
} from '@alga-psa/shared/lib/notificationAudience';
import { registerCapabilityParticipation, serves } from '@alga-psa/core/capability';
import { clearCapabilityCache } from '@alga-psa/core/capability/testing';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

/**
 * S33 (T042): what a seat technician is told about a ticket, against the real schema.
 *
 * One MSP tenant. Client A has a live seat arrangement whose scope is one board, with one seat
 * technician (a real internal user holding an active assignment, written directly: no invitation
 * command is on main). Client B has no arrangement. The real email and in-app handlers run over
 * real rows; only the mail transport is replaced, and it records the template context it is
 * handed, which is everything the rendered message can contain.
 */
type Copied = Array<{ email: string }>;
type Sent = { to: string; cc?: Copied; bcc?: Copied; template: string; context: unknown; replyContext?: { tokenMetadata?: Record<string, unknown> } };
const sent: Sent[] = [];
let testDb: Knex;

vi.mock('../../lib/db/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/db/db')>()),
  getConnection: async () => testDb,
}));

vi.mock('../../lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/db')>()),
  createTenantKnex: async (tenant?: string) => ({ knex: testDb, tenant }),
}));

vi.mock('../../lib/notifications/sendEventEmail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/notifications/sendEventEmail')>()),
  sendEventEmail: vi.fn(async (params: Sent) => {
    sent.push({ to: params.to, cc: params.cc, bcc: params.bcc, template: params.template, context: params.context, replyContext: params.replyContext });
  }),
}));

// Visibility filter dependencies (`filterRecipientsWhoCanReadTicket`): load the user from the test
// DB and grant RBAC and record-level read, as on main, where the filter does not narrow seat technicians.
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    getUserWithRoles: async (userId: string, tenant: string) => {
      const user = await actual.tenantDb(testDb, tenant).table('users').where({ user_id: userId }).first();
      return user ? { ...user, roles: [] } : null;
    },
  };
});
vi.mock('@alga-psa/auth/rbac', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth/rbac')>()),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/tickets/lib/ticketRecordAuthorization', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/tickets/lib/ticketRecordAuthorization')>()),
  authorizeTicketRecordAccess: vi.fn(async () => ({})),
}));

const SEAT_EMAIL = 'seat.tech@client-a.example.com';
const MSP_EMAIL = 'msp.agent@msp.example.com';
const AUTHOR_EMAIL = 'msp.author@msp.example.com';
const OUTSIDER_EMAIL = 'vendor@elsewhere.example.com';
const CLIENT_EMAIL = 'billing@test-client.test';

/** A BlockNote body, optionally @-mentioning users. */
const note = (text: string, mentions: string[] = []) => JSON.stringify([{
  type: 'paragraph',
  content: [
    { type: 'text', text, styles: {} },
    ...mentions.map((userId) => ({ type: 'mention', props: { userId, username: 'user', displayName: 'User' } })),
  ],
}]);

describe('audience-safe notifications for a seat technician (integration)', () => {
  let tenant: string;
  let scoped: ReturnType<typeof tenantDb>;
  let clientA: string;
  let clientB: string;
  let boardIn: string;
  let boardOut: string;
  let statusId: string;
  let closedStatusId: string;
  let priorityId: string;
  let arrangementId: string;
  let seat: string;
  let msp: string;
  let author: string;
  let emailCommentAdded: (event: any) => Promise<void>;
  let emailClosed: (event: any) => Promise<void>;
  let emailAssigned: (event: any) => Promise<void>;
  let emailCreated: (event: any) => Promise<void>;
  let inAppCommentAdded: (event: any, opts?: any) => Promise<void>;
  let inAppAssigned: (event: any, opts?: any) => Promise<void>;

  beforeAll(async () => {
    testDb = await createTestDbConnection();
    (globalThis as any).__algaWriteAdmissionState = undefined;
    (globalThis as any).__algaWriteAdmissionResolver = undefined;
    ({ ticketEmailSubscriberTestHarness: {
      handleTicketCommentAdded: emailCommentAdded, handleTicketClosed: emailClosed, handleTicketAssigned: emailAssigned,
      handleTicketCreated: emailCreated,
    } } = await import('../../lib/eventBus/subscribers/ticketEmailSubscriber'));
    ({ internalNotificationSubscriberTestHarness: {
      handleTicketCommentAdded: inAppCommentAdded, handleTicketAssigned: inAppAssigned,
    } } = await import('../../lib/eventBus/subscribers/internalNotificationSubscriber'));

    tenant = await createTenant(testDb, `SeatNotify ${uuidv4().slice(0, 6)}`);
    scoped = tenantDb(testDb, tenant);
    clientA = await createClient(testDb, tenant, 'Client A');
    clientB = await createClient(testDb, tenant, 'Client B');
    seat = await createUser(testDb, tenant, { email: SEAT_EMAIL });
    msp = await createUser(testDb, tenant, { email: MSP_EMAIL });
    author = await createUser(testDb, tenant, { email: AUTHOR_EMAIL });

    boardIn = uuidv4();
    boardOut = uuidv4();
    statusId = uuidv4();
    closedStatusId = uuidv4();
    priorityId = uuidv4();
    await scoped.table('boards').insert([
      { tenant, board_id: boardIn, board_name: 'Shared desk', is_default: true },
      { tenant, board_id: boardOut, board_name: 'MSP only', is_default: false },
    ]);
    await scoped.table('statuses').insert([
      { tenant, status_id: statusId, board_id: boardIn, name: 'Open', status_type: 'ticket', item_type: 'ticket', order_number: 1, is_default: true, is_closed: false },
      { tenant, status_id: closedStatusId, board_id: boardIn, name: 'Closed', status_type: 'ticket', item_type: 'ticket', order_number: 2, is_default: false, is_closed: true },
    ]);
    await scoped.table('priorities').insert({ tenant, priority_id: priorityId, priority_name: 'Medium', item_type: 'ticket', order_number: 1, color: '#ccc', created_by: msp });

    arrangementId = uuidv4();
    await scoped.table('co_managed_seat_arrangements').insert({ tenant, arrangement_id: arrangementId, client_id: clientA, allocation_id: uuidv4(), state: 'active' });
    await testDb.transaction((trx) => retainBuiltinResolverSubject(trx, { tenant: tenant, userId: seat }, CO_MANAGED_SEAT_RESOLVER_ID));
    await scoped.table('co_managed_seat_assignments').insert({ tenant, assignment_id: uuidv4(), arrangement_id: arrangementId, user_id: seat, state: 'active' });
  }, 900_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    registerCapabilityParticipation('co-managed-seat', null);
    vi.restoreAllMocks();
    await testDb?.destroy();
  });

  beforeEach(async () => {
    // Each case starts with the capability undecided-or-open for this tenant, never forced.
    vi.unstubAllEnvs();
    vi.stubEnv('FORCE_CAPABILITIES', '');
    registerCapabilityParticipation('co-managed-seat', async ({ tenantIds }) => tenantIds);
    clearCapabilityCache();
    sent.length = 0;
    await scoped.table('internal_notifications').delete();
    // Every case starts with the arrangement's scope being exactly the shared board.
    await scoped.table('co_managed_seat_board_scopes').where({ arrangement_id: arrangementId }).delete();
    await scoped.table('co_managed_seat_board_scopes').insert({ tenant, arrangement_id: arrangementId, board_id: boardIn, can_create: false });
  });

  async function createTicket(extra: Record<string, unknown> = {}): Promise<string> {
    const ticketId = uuidv4();
    await scoped.table('tickets').insert({
      tenant, ticket_id: ticketId, ticket_number: `T-${uuidv4().slice(0, 6)}`, title: 'Printer on fire',
      client_id: clientA, board_id: boardIn, status_id: statusId, priority_id: priorityId, entered_at: new Date(),
      ...extra,
    });
    return ticketId;
  }

  const watch = (ticketId: string, input: Parameters<typeof addTicketWatcher>[3]) =>
    testDb.transaction((trx) => addTicketWatcher(trx, tenant, ticketId, input, author));

  /** An additional agent on the ticket: mailed every comment, internal notes included. */
  const addAgent = (ticketId: string, assignedTo: string, userId: string) => scoped.table('ticket_resources').insert({
    tenant, ticket_id: ticketId, assigned_to: assignedTo, additional_user_id: userId, role: 'support', assigned_at: new Date(),
  });

  async function comment(ticketId: string, text: string, fields: Record<string, unknown>, mentions: string[] = []): Promise<any> {
    const content = note(text, mentions);
    const created = await testDb.transaction((trx) => TicketModel.createComment({
      ticket_id: ticketId, content, author_type: 'internal', author_id: author, ...fields,
    } as any, tenant, trx));
    return {
      id: uuidv4(),
      eventType: 'TICKET_COMMENT_ADDED',
      timestamp: new Date().toISOString(),
      payload: {
        tenantId: tenant, ticketId, userId: author, actorUserId: author, actorType: 'USER',
        comment: { id: created.comment_id, content, author: 'MSP Author', isInternal: fields.is_internal === true },
      },
    };
  }
  const privateNote = (ticketId: string, text: string, mentions: string[] = []) => comment(ticketId, text, { is_internal: true }, mentions);
  const sharedNote = (ticketId: string, text: string, mentions: string[] = []) =>
    comment(ticketId, text, { is_internal: true, collaboration_audience: 'shared_it' }, mentions);
  const requesterNote = (ticketId: string, text: string) => comment(ticketId, text, { is_internal: false });

  async function deliver(event: any, email = emailCommentAdded, inApp: typeof inAppCommentAdded | null = inAppCommentAdded) {
    await runWithTenant(tenant, () => email(event));
    if (inApp) await runWithTenant(tenant, () => inApp(event, { propagateErrors: true }));
  }

  const mailTo = (address: string) => sent.filter((mail) => mail.to.toLowerCase() === address);
  const inAppFor = async (userId: string) => scoped.table('internal_notifications').where({ user_id: userId });
  /** Every address a captured message was handed to, in any position. */
  const addressesOf = (mail: Sent) => [mail.to, ...(mail.cc ?? []).map(a => a.email), ...(mail.bcc ?? []).map(a => a.email)].map(a => a.toLowerCase());
  const everyAddress = () => sent.flatMap(addressesOf);
  /** The one-off Cc/Bcc an agent put on a comment. */
  const copyTo = (event: any, recipients: { cc?: string[]; bcc?: string[] }, extra: Record<string, unknown> = {}) =>
    scoped.table('comments').where({ comment_id: event.payload.comment.id }).update({ metadata: { ...extra, email_recipients: {
      cc: (recipients.cc ?? []).map(email => ({ email })), bcc: (recipients.bcc ?? []).map(email => ({ email })),
    } } });
  /** What a message to an external party may be: requester-audience, client rendering, no MSP link. */
  const expectExternalRendering = (mail: Sent, requesterText: string, forbidden: string[] = []) => {
    const rendered = JSON.stringify(mail.context);
    expect(rendered).toContain(requesterText);
    expect(rendered).not.toContain('/msp/');
    expect(rendered).toContain('/client-portal/tickets/');
    for (const text of forbidden) expect(rendered).not.toContain(text);
    expect(mail.replyContext?.tokenMetadata).toMatchObject({ notificationAudience: 'requester' });
  };
  /** A second seat technician, of Client B, live and in scope there: out of scope on Client A's tickets. */
  async function withClientBSeat<T>(run: (seatB: { userId: string; email: string }) => Promise<T>): Promise<T> {
    const email = `seat.b.${uuidv4().slice(0, 6)}@client-b.example.com`;
    const userId = await createUser(testDb, tenant, { email });
    const arrangementB = uuidv4();
    await scoped.table('co_managed_seat_arrangements').insert({ tenant, arrangement_id: arrangementB, client_id: clientB, allocation_id: uuidv4(), state: 'active' });
    await scoped.table('co_managed_seat_board_scopes').insert({ tenant, arrangement_id: arrangementB, board_id: boardIn, can_create: false });
    await testDb.transaction((trx) => retainBuiltinResolverSubject(trx, { tenant: tenant, userId: userId }, CO_MANAGED_SEAT_RESOLVER_ID));
    await scoped.table('co_managed_seat_assignments').insert({ tenant, assignment_id: uuidv4(), arrangement_id: arrangementB, user_id: userId, state: 'active' });
    try {
      return await run({ userId, email });
    } finally {
      await scoped.table('co_managed_seat_assignments').where({ arrangement_id: arrangementB }).delete();
      await scoped.table('co_managed_seat_board_scopes').where({ arrangement_id: arrangementB }).delete();
      await scoped.table('co_managed_seat_arrangements').where({ arrangement_id: arrangementB }).delete();
    }
  }

  // Review reproduction (PR #4339): a Client A technician copied on another client's comment.
  it.each(['cc', 'bcc'] as const)('an out-of-scope technician in %s gets a message of their own, requester-only in the client rendering, and everyone else is still mailed (F080)', async (kind) => {
    const ticketId = await createTicket({ client_id: clientB, assigned_to: msp });
    const event = await requesterNote(ticketId, 'S33-OTHER-CLIENT-CONTENT');
    await copyTo(event, { [kind]: [OUTSIDER_EMAIL, SEAT_EMAIL] });
    await deliver(event);

    // The technician is on exactly one message, alone, rendered as an external party.
    const withSeat = sent.filter(mail => addressesOf(mail).includes(SEAT_EMAIL));
    expect(withSeat.map(addressesOf)).toEqual([[SEAT_EMAIL]]);
    expectExternalRendering(withSeat[0], 'S33-OTHER-CLIENT-CONTENT');
    expect(await inAppFor(seat)).toEqual([]);
    // The requester's message is the one that went out, with the permitted copy still on it.
    const requesterMail = mailTo(CLIENT_EMAIL);
    expect(requesterMail).toHaveLength(1);
    expect((requesterMail[0][kind] ?? []).map(a => a.email)).toEqual([OUTSIDER_EMAIL]);
    expect(JSON.stringify(requesterMail[0].context)).toContain('S33-OTHER-CLIENT-CONTENT');
  });

  it('a mixed envelope: the shared message keeps permitted addresses; each technician gets their own, the out-of-scope one as an external party', async () => {
    await withClientBSeat(async (seatB) => {
      const ticketId = await createTicket({ assigned_to: msp });
      const event = await requesterNote(ticketId, 'PUBLIC-COPIED-UPDATE');
      await copyTo(event, { cc: [OUTSIDER_EMAIL, SEAT_EMAIL], bcc: [seatB.email, 'auditor@elsewhere.example.com'] });
      await deliver(event);

      // Client B's technician is an external party on this ticket: a message of their own, requester content.
      const withSeatB = sent.filter(mail => addressesOf(mail).includes(seatB.email));
      expect(withSeatB.map(addressesOf)).toEqual([[seatB.email]]);
      expectExternalRendering(withSeatB[0], 'PUBLIC-COPIED-UPDATE');
      // The shared message: the requester, with the non-technician Cc and Bcc and nobody else.
      const requesterMail = mailTo(CLIENT_EMAIL);
      expect(requesterMail).toHaveLength(1);
      expect(requesterMail[0].cc?.map(a => a.email)).toEqual([OUTSIDER_EMAIL]);
      expect(requesterMail[0].bcc?.map(a => a.email)).toEqual(['auditor@elsewhere.example.com']);
      expect(requesterMail[0].replyContext?.tokenMetadata).toBeUndefined();
      // Client A's technician is on exactly one message, alone, rendered and tokened for them.
      const withSeat = sent.filter(mail => addressesOf(mail).includes(SEAT_EMAIL));
      expect(withSeat).toHaveLength(1);
      expect(addressesOf(withSeat[0])).toEqual([SEAT_EMAIL]);
      expect(JSON.stringify(withSeat[0].context)).toContain('PUBLIC-COPIED-UPDATE');
      expect(withSeat[0].replyContext?.tokenMetadata).toMatchObject({ notificationAudience: 'requester' });
    });
  });

  it('an envelope with no technician on it is sent exactly as built', async () => {
    const ticketId = await createTicket({ assigned_to: msp });
    const event = await requesterNote(ticketId, 'PUBLIC-NO-SEAT');
    await copyTo(event, { cc: [OUTSIDER_EMAIL], bcc: ['auditor@elsewhere.example.com'] });
    await deliver(event, emailCommentAdded, null);

    // The requester's message with its copies, then the assignee's own: nothing split, nothing tokened.
    expect(sent.map(addressesOf)).toEqual([[CLIENT_EMAIL, OUTSIDER_EMAIL, 'auditor@elsewhere.example.com'], [MSP_EMAIL]]);
    for (const mail of sent) expect(mail.replyContext?.tokenMetadata).toBeUndefined();
  });

  it('the Cc/Bcc fallback: an out-of-scope technician carrying the To does not hold back the other copied addresses', async () => {
    await withClientBSeat(async (seatB) => {
      // No requester address, so the copied addresses are mailed directly and the first Cc carries the To.
      const locations = () => scoped.table('client_locations').where({ client_id: clientA });
      await locations().update({ email: null });
      try {
        const ticketId = await createTicket({ assigned_to: msp });
        const event = await requesterNote(ticketId, 'PUBLIC-FALLBACK');
        await copyTo(event, { cc: [seatB.email, OUTSIDER_EMAIL, SEAT_EMAIL], bcc: ['auditor@elsewhere.example.com'] });
        await deliver(event, emailCommentAdded, null);

        // The out-of-scope technician carrying the To is mailed alone, as an external party.
        const withSeatB = sent.filter(mail => addressesOf(mail).includes(seatB.email));
        expect(withSeatB.map(addressesOf)).toEqual([[seatB.email]]);
        expectExternalRendering(withSeatB[0], 'PUBLIC-FALLBACK');
        // The next permitted Cc takes the To; the Bcc stays with it.
        const shared = mailTo(OUTSIDER_EMAIL);
        expect(shared).toHaveLength(1);
        expect(addressesOf(shared[0])).toEqual([OUTSIDER_EMAIL, 'auditor@elsewhere.example.com']);
        const withSeat = sent.filter(mail => addressesOf(mail).includes(SEAT_EMAIL));
        expect(withSeat).toHaveLength(1);
        expect(addressesOf(withSeat[0])).toEqual([SEAT_EMAIL]);
        expect(withSeat[0].replyContext?.tokenMetadata).toMatchObject({ notificationAudience: 'requester' });

        // Bcc only, and the only address is an out-of-scope technician: they are mailed alone, requester-only.
        sent.length = 0;
        const bccOnly = await requesterNote(ticketId, 'PUBLIC-FALLBACK-BCC');
        await copyTo(bccOnly, { bcc: [seatB.email] });
        await deliver(bccOnly, emailCommentAdded, null);
        const bccMail = sent.filter(mail => addressesOf(mail).includes(seatB.email));
        expect(bccMail.map(addressesOf)).toEqual([[seatB.email]]);
        expectExternalRendering(bccMail[0], 'PUBLIC-FALLBACK-BCC');
      } finally {
        await locations().update({ email: CLIENT_EMAIL });
      }
    });
  });

  it('the close email authorizes the resolution comment\'s Cc and Bcc too', async () => {
    const close = async (clientId: string) => {
      const ticketId = await createTicket({ client_id: clientId, assigned_to: msp });
      const resolution = await comment(ticketId, 'CLOSING-RESOLUTION', { is_internal: false, is_resolution: true });
      await copyTo(resolution, { cc: [OUTSIDER_EMAIL], bcc: [SEAT_EMAIL] }, { closes_ticket: true });
      await scoped.table('tickets').where({ ticket_id: ticketId }).update({ status_id: closedStatusId, closed_at: new Date(), closed_by: author });
      sent.length = 0;
      await runWithTenant(tenant, () => emailClosed({
        id: uuidv4(), eventType: 'TICKET_CLOSED', timestamp: new Date().toISOString(),
        payload: { tenantId: tenant, ticketId, userId: author, actorUserId: author, actorType: 'USER', changes: {} },
      }));
    };

    // Another client's ticket: the technician is an external party with a message of their own;
    // the requester and the Cc are mailed as before.
    await close(clientB);
    expect(mailTo(CLIENT_EMAIL).map(addressesOf)).toEqual([[CLIENT_EMAIL, OUTSIDER_EMAIL]]);
    const external = sent.filter(mail => addressesOf(mail).includes(SEAT_EMAIL));
    expect(external.map(addressesOf)).toEqual([[SEAT_EMAIL]]);
    expect(external[0].template).toBe('ticket-closed');
    expect(JSON.stringify(external[0].context)).not.toContain('/msp/');

    // Their own client's ticket: one message of their own.
    await close(clientA);
    expect(mailTo(CLIENT_EMAIL).map(addressesOf)).toEqual([[CLIENT_EMAIL, OUTSIDER_EMAIL]]);
    const withSeat = sent.filter(mail => addressesOf(mail).includes(SEAT_EMAIL));
    expect(withSeat.map(addressesOf)).toEqual([[SEAT_EMAIL]]);
    expect(withSeat[0].template).toBe('ticket-closed');
  });

  it('resolves a seat technician only while the ticket is in their scope', async () => {
    const inScope = await createTicket();
    const otherBoard = await createTicket({ board_id: boardOut });
    const otherClient = await createTicket({ client_id: clientB });
    const resolve = (ticketId: string, key: { userId?: string; email?: string }) =>
      resolveTicketNotificationRecipient(testDb, tenant, { ticketId }, key);

    expect(await resolve(inScope, { userId: seat })).toEqual({ seat: true, userId: seat, reader: { kind: 'seat', tenant, clientId: clientA } });
    // A watcher is only an address: the same technician is found by it, in any case.
    expect(await resolve(inScope, { email: SEAT_EMAIL.toUpperCase() })).toMatchObject({ seat: true, reader: { kind: 'seat' } });
    // Out of scope they are an external party: a requester reader, never null, never refused.
    const external = { seat: true, userId: seat, reader: { kind: 'requester', tenant } };
    expect(await resolve(otherBoard, { userId: seat })).toEqual(external);
    expect(await resolve(otherClient, { userId: seat })).toEqual(external);
    expect(recipientInScope(await resolve(inScope, { userId: seat }))).toBe(true);
    expect(recipientRendering(await resolve(inScope, { userId: seat }))).toBe('msp');
    expect(recipientInScope(await resolve(otherClient, { userId: seat }))).toBe(false);
    expect(recipientRendering(await resolve(otherClient, { userId: seat }))).toBe('client');
    expect(recipientRendering(await resolve(inScope, { userId: msp }))).toBe('msp');
    expect(await resolve(inScope, { userId: msp })).toEqual({ seat: false });
    expect(await resolve(otherClient, { email: 'someone@elsewhere.example.com' })).toEqual({ seat: false });
  });

  it('a private note produces no email and no in-app notification for the technician, as assignee, agent or mention (F080)', async () => {
    // The technician is reached every way an internal note reaches an internal user: as the
    // assignee, as an additional agent, and by an @-mention. MSP staff stand beside them as control.
    const assigned = await createTicket({ assigned_to: seat });
    await addAgent(assigned, seat, msp);
    const agent = await createTicket({ assigned_to: msp });
    await addAgent(agent, msp, seat);

    for (const ticketId of [assigned, agent]) {
      sent.length = 0;
      await scoped.table('internal_notifications').delete();
      await deliver(await privateNote(ticketId, 'PRIVATE-MARGIN-NOTE', [seat, msp]));

      expect(mailTo(SEAT_EMAIL)).toEqual([]);
      expect(await inAppFor(seat)).toEqual([]);
      // Control: MSP staff on the same ticket still get the note, text included, and the mention.
      const staffMail = mailTo(MSP_EMAIL);
      expect(staffMail).toHaveLength(1);
      expect(JSON.stringify(staffMail[0].context)).toContain('PRIVATE-MARGIN-NOTE');
      expect(await inAppFor(msp)).toHaveLength(1);
    }
  });

  it('a legacy internal note with no stored audience is private to the technician', async () => {
    const ticketId = await createTicket({ assigned_to: seat });
    const event = await privateNote(ticketId, 'LEGACY-INTERNAL');
    const thread = await scoped.table('comments').where({ comment_id: event.payload.comment.id }).first('thread_id');
    expect((await scoped.table('comment_threads').where({ thread_id: thread.thread_id }).first()).collaboration_audience).toBeNull();

    await deliver(event);
    expect(mailTo(SEAT_EMAIL)).toEqual([]);
    expect(await inAppFor(seat)).toEqual([]);
  });

  it('shared IT and requester notes reach the technician, and the reply token records the audience', async () => {
    const ticketId = await createTicket({ assigned_to: seat });
    await addAgent(ticketId, seat, msp);

    await deliver(await sharedNote(ticketId, 'SHARED-RUNBOOK-STEP', [seat]));
    let seatMail = mailTo(SEAT_EMAIL);
    expect(seatMail).toHaveLength(1);
    expect(JSON.stringify(seatMail[0].context)).toContain('SHARED-RUNBOOK-STEP');
    expect(seatMail[0].replyContext?.tokenMetadata).toMatchObject({ notificationAudience: 'shared_it' });
    // The mention in a shared IT note is theirs to see.
    expect(await inAppFor(seat)).toHaveLength(1);
    // MSP staff are unchanged: delivered, and no audience is written onto their token.
    expect(mailTo(MSP_EMAIL)).toHaveLength(1);
    expect(mailTo(MSP_EMAIL)[0].replyContext?.tokenMetadata).toBeUndefined();

    sent.length = 0;
    await scoped.table('internal_notifications').delete();
    await deliver(await requesterNote(ticketId, 'PUBLIC-UPDATE'));
    seatMail = mailTo(SEAT_EMAIL);
    expect(seatMail).toHaveLength(1);
    expect(JSON.stringify(seatMail[0].context)).toContain('PUBLIC-UPDATE');
    expect(seatMail[0].replyContext?.tokenMetadata).toMatchObject({ notificationAudience: 'requester' });
    expect(await inAppFor(seat)).toHaveLength(1);
  });

  it('the email to a technician for a ticket with private notes contains no private text (F080)', async () => {
    const ticketId = await createTicket({ assigned_to: seat });
    await addAgent(ticketId, seat, msp);
    // An older client-visible resolution, then the latest resolution, which is private.
    await comment(ticketId, 'PUBLIC-RESOLUTION', { is_internal: false, is_resolution: true });
    await new Promise((resolve) => setTimeout(resolve, 15));
    await comment(ticketId, 'PRIVATE-RESOLUTION-COST', { is_internal: true, is_resolution: true });
    await scoped.table('tickets').where({ ticket_id: ticketId }).update({ status_id: closedStatusId, closed_at: new Date(), closed_by: author });

    await runWithTenant(tenant, () => emailClosed({
      id: uuidv4(), eventType: 'TICKET_CLOSED', timestamp: new Date().toISOString(),
      payload: { tenantId: tenant, ticketId, userId: author, actorUserId: author, actorType: 'USER', changes: {} },
    }));

    const seatMail = mailTo(SEAT_EMAIL);
    expect(seatMail).toHaveLength(1);
    const rendered = JSON.stringify(seatMail[0].context);
    expect(rendered).not.toContain('PRIVATE-RESOLUTION-COST');
    expect(rendered).toContain('PUBLIC-RESOLUTION');
    // Control: the MSP agent is quoted the private resolution, as before.
    const staffMail = mailTo(MSP_EMAIL);
    expect(staffMail).toHaveLength(1);
    expect(JSON.stringify(staffMail[0].context)).toContain('PRIVATE-RESOLUTION-COST');
  });

  it('a ticket-level notification reaches the technician in scope, and as an external party once the ticket leaves it (F083)', async () => {
    const ticketId = await createTicket({ assigned_to: seat });
    const assigned = () => ({
      id: uuidv4(), eventType: 'TICKET_ASSIGNED', timestamp: new Date().toISOString(),
      payload: { tenantId: tenant, ticketId, userId: seat, assignedByUserId: author, actorUserId: author, actorType: 'USER', changes: {} },
    });

    await deliver(assigned(), emailAssigned, inAppAssigned);
    expect(mailTo(SEAT_EMAIL)).toHaveLength(1);
    expect(JSON.stringify(mailTo(SEAT_EMAIL)[0].context)).toContain('/msp/');
    expect((await inAppFor(seat)).length).toBe(1);

    // The board leaves the arrangement's scope: the same facts, now as an external party (no MSP link).
    sent.length = 0;
    await scoped.table('internal_notifications').delete();
    await scoped.table('co_managed_seat_board_scopes').where({ arrangement_id: arrangementId }).delete();
    await deliver(assigned(), emailAssigned, inAppAssigned);
    expect(mailTo(SEAT_EMAIL)).toHaveLength(1);
    expect(JSON.stringify(mailTo(SEAT_EMAIL)[0].context)).not.toContain('/msp/');
    expect((await inAppFor(seat)).length).toBe(1);
  });

  it('an existing watcher subscription is upgraded when the ticket moves into scope and downgraded when it moves out (F083)', async () => {
    const ticketId = await createTicket({ assigned_to: msp });
    await watch(ticketId, { user_id: seat });

    // In scope: the MSP rendering.
    await deliver(await requesterNote(ticketId, 'PUBLIC-BEFORE-MOVE'));
    expect(mailTo(SEAT_EMAIL)).toHaveLength(1);
    expect(JSON.stringify(mailTo(SEAT_EMAIL)[0].context)).toContain('/msp/');

    // The ticket moves to a client the technician does not belong to. The same row now reads as
    // an external party: requester content, client template and portal link, nothing private or shared.
    sent.length = 0;
    await scoped.table('tickets').where({ ticket_id: ticketId }).update({ client_id: clientB });
    await deliver(await requesterNote(ticketId, 'PUBLIC-AFTER-MOVE'));
    expect(mailTo(SEAT_EMAIL)).toHaveLength(1);
    expectExternalRendering(mailTo(SEAT_EMAIL)[0], 'PUBLIC-AFTER-MOVE');
    expect(await inAppFor(seat)).toEqual([]);
    expect(mailTo(MSP_EMAIL)).toHaveLength(1); // the assignee, unaffected
    expect(JSON.stringify(mailTo(MSP_EMAIL)[0].context)).toContain('/msp/');
    const rows = await scoped.table('ticket_watchers').where({ ticket_id: ticketId }).whereRaw('lower(email) = ?', [SEAT_EMAIL]);
    expect(rows).toHaveLength(1);

    // Private notes are not sent to an external party, email or in-app.
    sent.length = 0;
    await deliver(await privateNote(ticketId, 'PRIVATE-WHILE-EXTERNAL', [seat]));
    expect(mailTo(SEAT_EMAIL)).toEqual([]);
    expect(await inAppFor(seat)).toEqual([]);

    // Client changed back: the same subscription is upgraded again, with no re-subscribe.
    sent.length = 0;
    await scoped.table('tickets').where({ ticket_id: ticketId }).update({ client_id: clientA });
    await deliver(await requesterNote(ticketId, 'PUBLIC-AFTER-RETURN'));
    expect(mailTo(SEAT_EMAIL)).toHaveLength(1);
    expect(JSON.stringify(mailTo(SEAT_EMAIL)[0].context)).toContain('/msp/');

    // A board added to scope upgrades a ticket on a board that was outside it.
    const otherBoard = await createTicket({ board_id: boardOut, assigned_to: msp });
    await watch(otherBoard, { user_id: seat });
    sent.length = 0;
    await deliver(await requesterNote(otherBoard, 'PUBLIC-OTHER-BOARD'), emailCommentAdded, null);
    expectExternalRendering(mailTo(SEAT_EMAIL)[0], 'PUBLIC-OTHER-BOARD');
    await scoped.table('co_managed_seat_board_scopes').insert({ tenant, arrangement_id: arrangementId, board_id: boardOut, can_create: false });
    sent.length = 0;
    await deliver(await requesterNote(otherBoard, 'PUBLIC-BOARD-ADDED'), emailCommentAdded, null);
    expect(JSON.stringify(mailTo(SEAT_EMAIL)[0].context)).toContain('/msp/');
  });

  it('a technician is admitted as a watcher on any ticket, and an out-of-scope one is an external party (F083)', async () => {
    const otherClient = await createTicket({ client_id: clientB, assigned_to: msp });
    const otherBoard = await createTicket({ board_id: boardOut, assigned_to: msp });
    const inScope = await createTicket({ assigned_to: msp });

    for (const ticketId of [otherClient, otherBoard]) {
      for (const input of [{ user_id: seat }, { email: SEAT_EMAIL }]) {
        const added = await watch(ticketId, input);
        expect(added.watchers.map((watcher) => watcher.email)).toContain(SEAT_EMAIL);
      }
      const rows = await scoped.table('ticket_watchers').where({ ticket_id: ticketId }).whereRaw('lower(email) = ?', [SEAT_EMAIL]);
      expect(rows).toHaveLength(1);
      // A batch (inbound mail, board defaults, team expansion) includes them.
      await scoped.table('ticket_watchers').where({ ticket_id: ticketId }).whereRaw('lower(email) = ?', [SEAT_EMAIL]).delete();
      const batch = await testDb.transaction((trx) => addTicketWatcherRecipients(trx, tenant, ticketId, [
        { email: SEAT_EMAIL, entity_type: 'user', entity_id: seat, source: 'board_default' },
        { email: MSP_EMAIL, entity_type: 'user', entity_id: msp, source: 'board_default' },
      ], author));
      expect(batch.watchers.map((watcher) => watcher.email).sort()).toEqual([MSP_EMAIL, SEAT_EMAIL].sort());
    }

    // Out of scope: requester-audience client rendering only, for email and in-app.
    sent.length = 0;
    await deliver(await requesterNote(otherClient, 'PUBLIC-EXTERNAL-WATCH'), emailCommentAdded, inAppCommentAdded);
    expect(mailTo(SEAT_EMAIL)).toHaveLength(1);
    expectExternalRendering(mailTo(SEAT_EMAIL)[0], 'PUBLIC-EXTERNAL-WATCH');
    for (const [kind, text] of [['private', 'PRIVATE-EXTERNAL-WATCH']] as const) {
      sent.length = 0;
      await scoped.table('internal_notifications').delete();
      await deliver(await privateNote(otherClient, text, [seat]));
      expect(JSON.stringify(sent.filter(mail => addressesOf(mail).includes(SEAT_EMAIL)))).not.toContain(text);
      expect(mailTo(SEAT_EMAIL)).toEqual([]);
      expect(await inAppFor(seat)).toEqual([]);
    }

    // In scope it is an ordinary watcher: the MSP rendering.
    expect((await watch(inScope, { user_id: seat })).watchers.map((watcher) => watcher.email)).toEqual([SEAT_EMAIL]);
    sent.length = 0;
    await deliver(await requesterNote(inScope, 'PUBLIC-IN-SCOPE-WATCH'), emailCommentAdded, null);
    expect(JSON.stringify(mailTo(SEAT_EMAIL)[0].context)).toContain('PUBLIC-IN-SCOPE-WATCH');
    expect(JSON.stringify(mailTo(SEAT_EMAIL)[0].context)).toContain('/msp/');

    // Paused, then switched back on after the board leaves the scope: admitted, now external.
    await testDb.transaction((trx) => setTicketWatcherActive(trx, tenant, inScope, SEAT_EMAIL, false, author));
    await scoped.table('co_managed_seat_board_scopes').where({ arrangement_id: arrangementId }).delete();
    const reactivation = await testDb.transaction((trx) => setTicketWatcherActive(trx, tenant, inScope, SEAT_EMAIL, true, author));
    expect(reactivation.changed).toBe(true);
  });

  it('an out-of-scope technician who watches and is also a board-rule recipient is mailed once, in the client rendering (F083)', async () => {
    const ruleId = uuidv4();
    await scoped.table('board_notification_rules').insert({ tenant, rule_id: ruleId, board_id: boardIn, notify_on_create: true });
    await scoped.table('board_notification_rule_recipients').insert({ tenant, rule_id: ruleId, recipient_type: 'user', user_id: seat });
    try {
      const ticketId = await createTicket({ client_id: clientB, assigned_to: msp });
      await watch(ticketId, { user_id: seat });
      await runWithTenant(tenant, () => emailCreated({
        id: uuidv4(), eventType: 'TICKET_CREATED', timestamp: new Date().toISOString(),
        payload: { tenantId: tenant, ticketId, userId: author, actorUserId: author, actorType: 'USER', occurredAt: new Date().toISOString() },
      }));
      const seatMail = sent.filter(mail => addressesOf(mail).includes(SEAT_EMAIL));
      expect(seatMail).toHaveLength(1);
      expect(seatMail[0].template).not.toBe('ticket-board-created');
      expect(JSON.stringify(seatMail[0].context)).not.toContain('/msp/');
      expect(JSON.stringify(seatMail[0].context)).toContain('/client-portal/tickets/');
    } finally {
      await scoped.table('board_notification_rule_recipients').where({ rule_id: ruleId }).delete();
      await scoped.table('board_notification_rules').where({ rule_id: ruleId }).delete();
    }
  });

  it('an out-of-scope technician\'s email reply is admitted and stored as requester, never shared IT (F083)', async () => {
    const otherClient = await createTicket({ client_id: clientB, assigned_to: msp });
    const external = { seat: true, author: { kind: 'requester', tenant }, audience: 'requester' };
    for (const notificationAudience of [undefined, 'requester', 'shared_it', 'organization_private'] as const) {
      expect(await resolveInboundReplyAudience(testDb, tenant, { ticketId: otherClient, userId: seat, notificationAudience }))
        .toMatchObject(external);
    }
    // The comment writer accepts it: a seat technician user writing with a requester author.
    const reply = await resolveInboundReplyAudience(testDb, tenant, { ticketId: otherClient, userId: seat, notificationAudience: 'shared_it' });
    if (!reply.seat) throw new Error('expected a seat technician');
    const created = await testDb.transaction((trx) => TicketModel.createComment({
      ticket_id: otherClient, content: note('EXTERNAL-REPLY'), author_type: 'internal', author_id: seat,
      is_internal: false, collaboration_audience: reply.audience, audience_author: reply.author,
    } as any, tenant, trx));
    const stored = await scoped.table('comments as c').join('comment_threads as t', function () {
      this.on('c.thread_id', 't.thread_id').andOn('c.tenant', 't.tenant');
    }).where('c.comment_id', created.comment_id).first({ is_internal: 'c.is_internal', audience: 't.collaboration_audience' });
    expect(stored.is_internal).toBe(false);
    expect(stored.audience === 'requester' || stored.audience === null).toBe(true);
    // In scope is unchanged: shared IT notifications are answered as shared IT.
    const inScope = await createTicket();
    expect(await resolveInboundReplyAudience(testDb, tenant, { ticketId: inScope, userId: seat, notificationAudience: 'shared_it' }))
      .toMatchObject({ seat: true, author: { kind: 'seat' }, audience: 'shared_it' });
    expect(await resolveInboundReplyAudience(testDb, tenant, { ticketId: inScope, userId: seat, notificationAudience: 'organization_private' }))
      .toMatchObject({ seat: true, audience: 'shared_it' });
  });

  it('an in-app notification that does not declare its audience is never created for a technician', async () => {
    const { createNotificationFromTemplateInternal } = await import('@alga-psa/notifications/actions');
    const ticketId = await createTicket({ assigned_to: seat });
    const request = (userId: string, extra: Record<string, unknown> = {}) => ({
      tenant, user_id: userId, template_name: 'ticket-assigned', type: 'info' as const, category: 'tickets',
      data: { ticketId: 'T-1', ticketNumber: 'T-1', ticketTitle: 'Printer on fire', priority: 'Medium', performedByName: 'MSP Author' },
      ...extra,
    });

    expect(await runWithTenant(tenant, () => createNotificationFromTemplateInternal(testDb, request(seat)))).toBeNull();
    expect(await runWithTenant(tenant, () => createNotificationFromTemplateInternal(
      testDb, request(seat, { ticketAudience: { ticketId, audience: 'organization_private' } })))).toBeNull();
    expect(await runWithTenant(tenant, () => createNotificationFromTemplateInternal(
      testDb, request(seat, { ticketAudience: { ticketId, audience: 'requester' } })))).not.toBeNull();
    // Out of scope they are an external party: requester notifications only.
    const otherClient = await createTicket({ client_id: clientB });
    expect(await runWithTenant(tenant, () => createNotificationFromTemplateInternal(testDb, request(seat)))).toBeNull();
    for (const audience of ['shared_it', 'organization_private'] as const) {
      expect(await runWithTenant(tenant, () => createNotificationFromTemplateInternal(
        testDb, request(seat, { ticketAudience: { ticketId: otherClient, audience } })))).toBeNull();
    }
    expect(await runWithTenant(tenant, () => createNotificationFromTemplateInternal(
      testDb, request(seat, { ticketAudience: { ticketId: otherClient, audience: 'requester' } })))).not.toBeNull();
    // MSP staff need no declaration.
    expect(await runWithTenant(tenant, () => createNotificationFromTemplateInternal(testDb, request(msp)))).not.toBeNull();
  });

  /**
   * Release posture: the boundary exists only while the tenant is served `co-managed-seat`.
   * Closed, by the kill switch or because the tenant has no seat arrangement, a user holding a
   * seat row is an ordinary internal user at every enforcement point, exactly as before S33.
   */
  describe('behind the co-managed-seat capability', () => {
    const closedBy = {
      'FORCE_CAPABILITIES=co-managed-seat:off': () => vi.stubEnv('FORCE_CAPABILITIES', 'co-managed-seat:off'),
      'a malformed kill switch value': () => vi.stubEnv('FORCE_CAPABILITIES', 'co-managed-seat:maybe'),
      'a tenant the capability does not serve': () => registerCapabilityParticipation('co-managed-seat', async () => []),
    };

    it.each(Object.keys(closedBy) as Array<keyof typeof closedBy>)('closed by %s: every enforcement point is neutral', async (how) => {
      closedBy[how]();
      clearCapabilityCache();
      expect((await serves('co-managed-seat', tenant)).served).toBe(false);

      const otherClient = await createTicket({ client_id: clientB, assigned_to: seat });
      // Resolution: nobody is a seat technician, on any ticket.
      expect(await resolveTicketNotificationRecipient(testDb, tenant, { ticketId: otherClient }, { userId: seat })).toEqual({ seat: false });

      // Email and in-app: an internal note on another client's ticket reaches them like any assignee,
      // text included, with no audience written on the reply token.
      await deliver(await privateNote(otherClient, 'PRIVATE-WHEN-CLOSED', [seat]));
      const seatMail = mailTo(SEAT_EMAIL);
      expect(seatMail).toHaveLength(1);
      expect(JSON.stringify(seatMail[0].context)).toContain('PRIVATE-WHEN-CLOSED');
      expect(seatMail[0].replyContext?.tokenMetadata).toBeUndefined();
      expect(await inAppFor(seat)).toHaveLength(1);

      // The envelope is not split: a copied technician stays on the requester's message.
      sent.length = 0;
      const copied = await createTicket({ client_id: clientB, assigned_to: msp });
      const event = await requesterNote(copied, 'PUBLIC-WHEN-CLOSED');
      await copyTo(event, { cc: [SEAT_EMAIL], bcc: [OUTSIDER_EMAIL] });
      await deliver(event, emailCommentAdded, null);
      expect(mailTo(CLIENT_EMAIL).map(addressesOf)).toEqual([[CLIENT_EMAIL, SEAT_EMAIL, OUTSIDER_EMAIL]]);
      expect(mailTo(SEAT_EMAIL)).toEqual([]);

      // In-app: no audience declaration is needed.
      const { createNotificationFromTemplateInternal } = await import('@alga-psa/notifications/actions');
      expect(await runWithTenant(tenant, () => createNotificationFromTemplateInternal(testDb, {
        tenant, user_id: seat, template_name: 'ticket-assigned', type: 'info' as const, category: 'tickets',
        data: { ticketId: 'T-1', ticketNumber: 'T-1', ticketTitle: 'Printer on fire', priority: 'Medium', performedByName: 'MSP Author' },
      }))).not.toBeNull();

      // Watchers: an out-of-scope ticket is not refused.
      expect((await watch(otherClient, { user_id: seat })).watchers.map((watcher) => watcher.email)).toEqual([SEAT_EMAIL]);

      // Inbound replies: the native reply rules stand.
      expect(await resolveInboundReplyAudience(testDb, tenant, { ticketId: otherClient, userId: seat })).toEqual({ seat: false });
    });

    const openBy = {
      'FORCE_CAPABILITIES=co-managed-seat:on': () => vi.stubEnv('FORCE_CAPABILITIES', 'co-managed-seat:on'),
      'a served tenant': () => registerCapabilityParticipation('co-managed-seat', async ({ tenantIds }) => tenantIds),
      // The gate could not decide. It reports "not served"; the boundary must not read that as closed.
      'a failing participation read': () => registerCapabilityParticipation('co-managed-seat', async () => { throw new Error('database unavailable'); }),
      'a process that registered no resolver': () => registerCapabilityParticipation('co-managed-seat', null),
    };

    it.each(Object.keys(openBy) as Array<keyof typeof openBy>)('open or undecided by %s: every enforcement point holds', async (how) => {
      openBy[how]();
      clearCapabilityCache();

      const otherClient = await createTicket({ client_id: clientB, assigned_to: seat });
      const inScope = await createTicket({ assigned_to: seat });
      expect(await resolveTicketNotificationRecipient(testDb, tenant, { ticketId: otherClient }, { userId: seat })).toEqual({ seat: true, userId: seat, reader: { kind: 'requester', tenant } });

      // Email and in-app: only requester content about another client's ticket, as an external party, and no private note in scope.
      await deliver(await requesterNote(otherClient, 'OTHER-CLIENT-PUBLIC'));
      await deliver(await privateNote(inScope, 'PRIVATE-IN-SCOPE', [seat]));
      const seatMails = sent.filter(mail => addressesOf(mail).includes(SEAT_EMAIL));
      expect(JSON.stringify(seatMails.map(mail => mail.context))).toContain('OTHER-CLIENT-PUBLIC');
      expect(JSON.stringify(seatMails.map(mail => mail.context))).not.toContain('/msp/');
      expect(JSON.stringify(seatMails.map(mail => mail.context))).not.toContain('PRIVATE-IN-SCOPE');
      expect(JSON.stringify((await inAppFor(seat)).map(row => row.message))).not.toContain('PRIVATE-IN-SCOPE');

      // The envelope: a copied technician is taken off the shared message and mailed on their own.
      const copied = await createTicket({ client_id: clientB, assigned_to: msp });
      const event = await requesterNote(copied, 'OTHER-CLIENT-COPIED');
      sent.length = 0;
      await copyTo(event, { cc: [SEAT_EMAIL], bcc: [OUTSIDER_EMAIL] });
      await deliver(event, emailCommentAdded, null);
      expect(mailTo(CLIENT_EMAIL).map(addressesOf)).toEqual([[CLIENT_EMAIL, OUTSIDER_EMAIL]]);
      expect(sent.filter(mail => addressesOf(mail).includes(SEAT_EMAIL)).map(addressesOf)).toEqual([[SEAT_EMAIL]]);

      // Watchers are admitted; inbound replies are admitted as requester out of scope, shared IT in scope.
      expect((await watch(otherClient, { user_id: seat })).watchers.map((watcher) => watcher.email)).toEqual([SEAT_EMAIL]);
      expect(await resolveInboundReplyAudience(testDb, tenant, { ticketId: otherClient, userId: seat }))
        .toMatchObject({ seat: true, audience: 'requester', author: { kind: 'requester' } });
      expect(await resolveInboundReplyAudience(testDb, tenant, { ticketId: inScope, userId: seat, notificationAudience: 'shared_it' }))
        .toMatchObject({ seat: true, audience: 'shared_it' });
    });
  });
});
