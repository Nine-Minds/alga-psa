import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant, tenantDb } from '@alga-psa/db';
import { TicketModel } from '@alga-psa/shared/models/ticketModel';
import {
  addTicketWatcher, addTicketWatcherRecipients, setTicketWatcherActive, TicketWatcherError,
} from '@alga-psa/shared/services/tickets/ticketWatcherService';
import { resolveTicketNotificationRecipient } from '@alga-psa/shared/lib/notificationAudience';

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
type Sent = { to: string; template: string; context: unknown; replyContext?: { tokenMetadata?: Record<string, unknown> } };
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
    sent.push({ to: params.to, template: params.template, context: params.context, replyContext: params.replyContext });
  }),
}));

const SEAT_EMAIL = 'seat.tech@client-a.example.com';
const MSP_EMAIL = 'msp.agent@msp.example.com';
const AUTHOR_EMAIL = 'msp.author@msp.example.com';

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
  let inAppCommentAdded: (event: any, opts?: any) => Promise<void>;
  let inAppAssigned: (event: any, opts?: any) => Promise<void>;

  beforeAll(async () => {
    testDb = await createTestDbConnection();
    (globalThis as any).__algaWriteAdmissionState = undefined;
    (globalThis as any).__algaWriteAdmissionResolver = undefined;
    ({ ticketEmailSubscriberTestHarness: {
      handleTicketCommentAdded: emailCommentAdded, handleTicketClosed: emailClosed, handleTicketAssigned: emailAssigned,
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
    await scoped.table('co_managed_seat_assignments').insert({ tenant, assignment_id: uuidv4(), arrangement_id: arrangementId, user_id: seat, state: 'active' });
  }, 900_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await testDb?.destroy();
  });

  beforeEach(async () => {
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

  it('resolves a seat technician only while the ticket is in their scope', async () => {
    const inScope = await createTicket();
    const otherBoard = await createTicket({ board_id: boardOut });
    const otherClient = await createTicket({ client_id: clientB });
    const resolve = (ticketId: string, key: { userId?: string; email?: string }) =>
      resolveTicketNotificationRecipient(testDb, tenant, { ticketId }, key);

    expect(await resolve(inScope, { userId: seat })).toEqual({ seat: true, userId: seat, reader: { kind: 'seat', tenant, clientId: clientA } });
    // A watcher is only an address: the same technician is found by it, in any case.
    expect(await resolve(inScope, { email: SEAT_EMAIL.toUpperCase() })).toMatchObject({ seat: true, reader: { kind: 'seat' } });
    expect(await resolve(otherBoard, { userId: seat })).toEqual({ seat: true, userId: seat, reader: null });
    expect(await resolve(otherClient, { userId: seat })).toEqual({ seat: true, userId: seat, reader: null });
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

  it('a ticket-level notification reaches the technician in scope and stops once the ticket leaves it (F083)', async () => {
    const ticketId = await createTicket({ assigned_to: seat });
    const assigned = () => ({
      id: uuidv4(), eventType: 'TICKET_ASSIGNED', timestamp: new Date().toISOString(),
      payload: { tenantId: tenant, ticketId, userId: seat, assignedByUserId: author, actorUserId: author, actorType: 'USER', changes: {} },
    });

    await deliver(assigned(), emailAssigned, inAppAssigned);
    expect(mailTo(SEAT_EMAIL)).toHaveLength(1);
    expect((await inAppFor(seat)).length).toBe(1);

    // The board leaves the arrangement's scope: nothing more is delivered, with no cleanup.
    sent.length = 0;
    await scoped.table('internal_notifications').delete();
    await scoped.table('co_managed_seat_board_scopes').where({ arrangement_id: arrangementId }).delete();
    await deliver(assigned(), emailAssigned, inAppAssigned);
    expect(mailTo(SEAT_EMAIL)).toEqual([]);
    expect(await inAppFor(seat)).toEqual([]);
  });

  it('an existing watcher subscription stops delivering when the ticket leaves scope (F083)', async () => {
    const ticketId = await createTicket({ assigned_to: msp });
    await watch(ticketId, { user_id: seat });

    // Watchers are mailed public comments.
    await deliver(await requesterNote(ticketId, 'PUBLIC-BEFORE-MOVE'));
    expect(mailTo(SEAT_EMAIL)).toHaveLength(1);

    // The ticket moves to a client the technician does not belong to. The watcher row stays.
    sent.length = 0;
    await scoped.table('tickets').where({ ticket_id: ticketId }).update({ client_id: clientB });
    await deliver(await requesterNote(ticketId, 'PUBLIC-AFTER-MOVE'));
    expect(mailTo(SEAT_EMAIL)).toEqual([]);
    expect(mailTo(MSP_EMAIL)).toHaveLength(1); // the assignee, unaffected
    const rows = await scoped.table('ticket_watchers').where({ ticket_id: ticketId }).whereRaw('lower(email) = ?', [SEAT_EMAIL]);
    expect(rows).toHaveLength(1);
  });

  it('a technician cannot watch, or be added as a watcher on, an out-of-scope ticket (F083)', async () => {
    const otherClient = await createTicket({ client_id: clientB, assigned_to: msp });
    const otherBoard = await createTicket({ board_id: boardOut, assigned_to: msp });
    const inScope = await createTicket({ assigned_to: msp });

    for (const ticketId of [otherClient, otherBoard]) {
      for (const input of [{ user_id: seat }, { email: SEAT_EMAIL }]) {
        const refusal = await watch(ticketId, input).catch((error) => error);
        expect(refusal).toBeInstanceOf(TicketWatcherError);
        expect(refusal.kind).toBe('watcher_out_of_scope');
      }
      // A batch (inbound mail, board defaults, team expansion) leaves the technician out and keeps the rest.
      const batch = await testDb.transaction((trx) => addTicketWatcherRecipients(trx, tenant, ticketId, [
        { email: SEAT_EMAIL, entity_type: 'user', entity_id: seat, source: 'board_default' },
        { email: MSP_EMAIL, entity_type: 'user', entity_id: msp, source: 'board_default' },
      ], author));
      expect(batch.watchers.map((watcher) => watcher.email)).toEqual([MSP_EMAIL]);
      const mirror = (await scoped.table('tickets').where({ ticket_id: ticketId }).first('attributes')).attributes;
      expect(JSON.stringify(mirror)).not.toContain(SEAT_EMAIL);
    }

    // In scope it is an ordinary watcher.
    expect((await watch(inScope, { user_id: seat })).watchers.map((watcher) => watcher.email)).toEqual([SEAT_EMAIL]);
    // Paused, then the board leaves the scope: switching it back on is refused too.
    await testDb.transaction((trx) => setTicketWatcherActive(trx, tenant, inScope, SEAT_EMAIL, false, author));
    await scoped.table('co_managed_seat_board_scopes').where({ arrangement_id: arrangementId }).delete();
    const reactivation = await testDb.transaction((trx) => setTicketWatcherActive(trx, tenant, inScope, SEAT_EMAIL, true, author)).catch((error) => error);
    expect(reactivation).toMatchObject({ kind: 'watcher_out_of_scope' });
    // MSP staff are never refused.
    expect((await watch(otherClient, { user_id: author })).changed).toBe(true);
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
    // MSP staff need no declaration.
    expect(await runWithTenant(tenant, () => createNotificationFromTemplateInternal(testDb, request(msp)))).not.toBeNull();
  });
});
