/**
 * Co-managed seat and workspace shapes, slice S32 (F079, F081 / T041) on real Postgres.
 *
 * A handoff to client IT tells the named technician, or every active technician of that client
 * when none is named. A handoff to the MSP tells MSP staff by the assignment and board rules. A
 * shared IT note tells the other organization's participants on the ticket. Each case asserts the
 * exact set of users who received an in-app notification: the expected recipients and no one else.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import {
  createCoManagedSeatArrangement, handCoManagedSeatTicketToClientIt, handCoManagedSeatTicketToMsp,
  registerCoManagedSeatHandoffListener, resolveCoManagedSeatHandoffNotice, resolveCoManagedSeatSharedNoteRecipients,
  setCoManagedSeatBoardScope, type CoManagedSeatHandoffReceipt,
} from '@alga-psa/co-managed';
import { resolveCommentAudienceReader } from '@alga-psa/shared/lib/commentAudience';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';
import Comment from '../../../../packages/tickets/src/models/comment';

let db: Knex;
const deniedUserIds = new Set<string>();

// Creating a notification publishes a NOTIFICATION_SENT workflow event after commit; keep it off the bus.
vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/event-bus/publishers')>()),
  publishEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
}));
vi.mock('../../lib/db/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/db/db')>()),
  getConnection: async () => db,
}));
vi.mock('../../lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/db')>()),
  createTenantKnex: async (tenant?: string) => ({ knex: db, tenant }),
}));
// The board rule's visibility filter: load the user from the test database, grant RBAC read, and
// let the per-record policy deny specific users.
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    getUserWithRoles: async (userId: string, tenant: string) => {
      const user = await actual.tenantDb(db, tenant).table('users').where({ user_id: userId }).first();
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
  authorizeTicketRecordAccess: vi.fn(async (input: { user: { user_id: string } }) => {
    if (deniedUserIds.has(input.user.user_id)) throw new Error('Permission denied: Cannot access ticket');
    return {};
  }),
}));

const DAY = 86_400_000;
const NOTE = 'Needs a firewall change we cannot make.';
const TO_CLIENT_IT = 'ticket-handed-to-client-it';
const TO_MSP = 'ticket-handed-to-msp';
const COMMENT = 'ticket-comment-added';
const FORCE = 'FORCE_CAPABILITIES';
const TARGETING = 'FEATURE_FLAG_TENANTS__RELEASE_V2_0_FEATURE';
const describeDb = await describeWithDb();

describeDb('co-managed seat handoff and shared-note notifications', { shuffle: false }, () => {
  let ticketNumber = 0;
  let deliverHandoff: typeof import('../../lib/notifications/coManagedSeatNotifications').deliverCoManagedSeatHandoffNotifications;
  let commentAdded: (event: any, opts?: any) => Promise<void>;

  const board = async (tenant: string, defaultTeamId: string | null = null) => {
    const boardId = randomUUID();
    await db('boards').insert({ tenant, board_id: boardId, board_name: `Board ${boardId.slice(0, 8)}`, is_default: false,
      default_assigned_team_id: defaultTeamId });
    return boardId;
  };
  const seat = async (tenant: string, arrangementId: string, state: 'invited' | 'active' | 'revoked' = 'active', inactive = false) => {
    const userId = await createUser(db, tenant, { is_inactive: inactive });
    await db('co_managed_seat_assignments').insert({ tenant, assignment_id: randomUUID(), arrangement_id: arrangementId,
      user_id: userId, state, revoked_at: state === 'revoked' ? new Date() : null });
    return userId;
  };

  /**
   * A sponsor with an arranged client and a second arranged client. MSP staff: the actor, a
   * bystander, a default-team dispatcher, two board-rule users and an inactive team member. The
   * first client's technicians: two active, plus one invited, one revoked and one deactivated.
   * The dispatch team and the board rule also name a technician, who must never be told as MSP.
   */
  const world = async () => {
    const sponsor = await createTenant(db, `Notify sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('co_managed_entitlements').insert({ tenant: sponsor, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 20,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    const clientId = await createClient(db, sponsor, `Arranged ${randomUUID().slice(0, 8)}`);
    const otherClientId = await createClient(db, sponsor, `Other arranged ${randomUUID().slice(0, 8)}`);
    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: sponsor, clientId, operationId: randomUUID(), seats: 5 });
    const otherArrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: sponsor, clientId: otherClientId, operationId: randomUUID(), seats: 2 });
    const arrangementId = arrangement.arrangement_id;

    const [staff, bystander, dispatcher, ruleUser, deniedRuleUser, goneDispatcher, defaultAssignee] = [
      await createUser(db, sponsor), await createUser(db, sponsor), await createUser(db, sponsor), await createUser(db, sponsor),
      await createUser(db, sponsor), await createUser(db, sponsor, { is_inactive: true }), await createUser(db, sponsor),
    ];
    const [technician, otherTechnician, invited, revoked, deactivated] = [
      await seat(sponsor, arrangementId), await seat(sponsor, arrangementId), await seat(sponsor, arrangementId, 'invited'),
      await seat(sponsor, arrangementId, 'revoked'), await seat(sponsor, arrangementId, 'active', true),
    ];
    const elsewhereTechnician = await seat(sponsor, otherArrangement.arrangement_id);

    const teamId = randomUUID();
    await db('teams').insert({ tenant: sponsor, team_id: teamId, team_name: 'Dispatch', manager_id: staff });
    await db('team_members').insert([dispatcher, goneDispatcher, otherTechnician].map((user_id) => ({ tenant: sponsor, team_id: teamId, user_id })));
    const [inScope, plain] = [await board(sponsor, teamId), await board(sponsor)];
    for (const [id, boards] of [[arrangementId, [inScope, plain]], [otherArrangement.arrangement_id, [inScope]]] as const) {
      await setCoManagedSeatBoardScope(db, { sponsorTenant: sponsor, arrangementId: id, boards: boards.map((boardId) => ({ boardId, canCreate: true })) });
    }
    const ruleId = randomUUID();
    await db('board_notification_rules').insert({ tenant: sponsor, rule_id: ruleId, board_id: inScope, notify_on_create: true });
    await db('board_notification_rule_recipients').insert([ruleUser, deniedRuleUser, technician].map((user_id) => (
      { tenant: sponsor, rule_id: ruleId, recipient_type: 'user', user_id })));
    deniedUserIds.add(deniedRuleUser);

    return { sponsor, clientId, otherClientId, arrangementId, inScope, plain, staff, bystander, dispatcher, ruleUser, deniedRuleUser,
      goneDispatcher, defaultAssignee, technician, otherTechnician, invited, revoked, deactivated, elsewhereTechnician };
  };
  type World = Awaited<ReturnType<typeof world>>;

  const ticket = async (w: World, options: { boardId?: string; clientId?: string; assignedTo?: string | null } = {}) => {
    const ticketId = randomUUID();
    await db('tickets').insert({ tenant: w.sponsor, ticket_id: ticketId, ticket_number: `S32-${++ticketNumber}`, title: 'Notified ticket',
      client_id: options.clientId ?? w.clientId, board_id: options.boardId ?? w.inScope, assigned_to: options.assignedTo ?? null,
      entered_at: new Date(), updated_at: new Date() });
    return ticketId;
  };
  const request = (w: World, ticketId: string, actorUserId: string, expectedRevision: number, operationId: string = randomUUID()) =>
    ({ sponsorTenant: w.sponsor, ticketId, actorUserId, operationId, expectedRevision, note: NOTE });
  const deliver = (w: World, receipt: CoManagedSeatHandoffReceipt) => deliverHandoff(db, { tenantId: w.sponsor, operationId: receipt.operationId });

  /** Hands to client IT and delivers; returns the receipt. */
  const toClientIt = async (w: World, ticketId: string, expectedRevision: number, technicianUserId?: string) => {
    const receipt = await handCoManagedSeatTicketToClientIt(db, { ...request(w, ticketId, w.staff, expectedRevision), technicianUserId });
    await deliver(w, receipt);
    return receipt;
  };

  /** Everyone holding a notification of this template in the tenant, sorted, one entry per notification. */
  const told = async (w: World, template: string): Promise<string[]> =>
    (await db('internal_notifications').where({ tenant: w.sponsor, template_name: template }).orderBy('user_id').pluck('user_id'));
  const clear = (w: World) => db('internal_notifications').where({ tenant: w.sponsor }).delete();
  const sorted = (...ids: string[]) => [...ids].sort();

  /** A comment through the native writer, then the standard comment-added notification handler. */
  const comment = async (w: World, ticketId: string, authorUserId: string, audience: 'shared_it' | 'organization_private' | 'requester') => {
    const author = await resolveCommentAudienceReader(db, w.sponsor, { userId: authorUserId, userType: 'internal' });
    const isInternal = audience !== 'requester';
    const commentId = await Comment.insert(db, w.sponsor, {
      ticket_id: ticketId, user_id: authorUserId, author_type: 'internal', note: 'n', markdown_content: 'n', is_resolution: false,
      is_internal: isInternal, ...(audience === 'organization_private' ? {} : { collaboration_audience: audience }),
    } as any, undefined, author);
    const eventId = randomUUID();
    const notify = () => commentAdded({ id: eventId, timestamp: new Date().toISOString(), eventType: 'TICKET_COMMENT_ADDED', payload: { tenantId: w.sponsor, ticketId, userId: authorUserId,
      comment: { id: commentId, content: 'A shared note', author: 'Author', isInternal } } });
    await notify();
    return { commentId, notify };
  };

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 's32_seat_notifications_test' });
    ({ deliverCoManagedSeatHandoffNotifications: deliverHandoff } = await import('../../lib/notifications/coManagedSeatNotifications'));
    ({ internalNotificationSubscriberTestHarness: { handleInternalNotificationEvent: commentAdded } } = await import(
      '../../lib/eventBus/subscribers/internalNotificationSubscriber'));
  }, 900_000);
  afterAll(async () => { await db?.destroy(); });
  beforeEach(() => { process.env[FORCE] = 'co-managed-seat:on'; });
  afterEach(() => { delete process.env[FORCE]; delete process.env[TARGETING]; });

  // T041 / F079
  it('a handoff to client IT naming a technician notifies that technician and no one else', async () => {
    const w = await world();
    const ticketId = await ticket(w, { assignedTo: w.bystander });

    await toClientIt(w, ticketId, 0, w.technician);

    expect(await told(w, TO_CLIENT_IT)).toEqual([w.technician]);
    expect(await db('internal_notifications').where({ tenant: w.sponsor })).toHaveLength(1);
  });

  // T041 / F079
  it('a handoff to client IT naming no one notifies every active technician of that client and no one else', async () => {
    const w = await world();
    // Left assigned to MSP staff: an assignee who is not a technician names no one.
    const ticketId = await ticket(w, { assignedTo: w.bystander });

    await toClientIt(w, ticketId, 0);

    // Not the invited, revoked or deactivated seat, not another client's technician, no MSP staff, not the actor.
    expect(await told(w, TO_CLIENT_IT)).toEqual(sorted(w.technician, w.otherTechnician));
    expect(await db('internal_notifications').where({ tenant: w.sponsor })).toHaveLength(2);
  });

  // T041 / F079
  it('a ticket already with a technician is handed to that technician alone', async () => {
    const w = await world();
    const ticketId = await ticket(w, { assignedTo: w.otherTechnician });

    await toClientIt(w, ticketId, 0);

    expect(await told(w, TO_CLIENT_IT)).toEqual([w.otherTechnician]);
  });

  // T041 / F079
  it('a handoff to the MSP that leaves the ticket unassigned notifies the board\'s team and its notification rule, MSP staff only', async () => {
    const w = await world();
    const ticketId = await ticket(w);
    await toClientIt(w, ticketId, 0, w.technician);
    await clear(w);

    const receipt = await handCoManagedSeatTicketToMsp(db, request(w, ticketId, w.technician, 1));
    expect(receipt.assignedTo).toBeNull();
    await deliver(w, receipt);

    // The dispatch team's active MSP member and the rule's readable MSP user. Not the inactive
    // member, not the technicians the team and the rule also name, not the rule user who cannot
    // open the ticket, not uninvolved staff, not the actor.
    expect(await told(w, TO_MSP)).toEqual(sorted(w.dispatcher, w.ruleUser));
    expect(await db('internal_notifications').where({ tenant: w.sponsor })).toHaveLength(2);
  });

  // T041 / F079
  it('a handoff to the MSP that leaves an MSP assignee notifies the assignee, not the team', async () => {
    const w = await world();
    await db('co_managed_seat_arrangements').where({ tenant: w.sponsor, arrangement_id: w.arrangementId })
      .update({ handoff_defaults: JSON.stringify({ assigned_to: w.defaultAssignee }) });
    // No board rule and no default team on this board: the assignment rule alone.
    const ticketId = await ticket(w, { boardId: w.plain });
    await toClientIt(w, ticketId, 0, w.technician);
    await clear(w);

    const receipt = await handCoManagedSeatTicketToMsp(db, request(w, ticketId, w.technician, 1));
    expect(receipt.assignedTo).toBe(w.defaultAssignee);
    await deliver(w, receipt);

    expect(await told(w, TO_MSP)).toEqual([w.defaultAssignee]);
    expect(await db('internal_notifications').where({ tenant: w.sponsor })).toHaveLength(1);

    // On the board with a team and a rule: the assignee replaces the team, the rule still applies.
    const queued = await ticket(w);
    await toClientIt(w, queued, 0, w.technician);
    await clear(w);
    await deliver(w, await handCoManagedSeatTicketToMsp(db, request(w, queued, w.technician, 1)));
    expect(await told(w, TO_MSP)).toEqual(sorted(w.defaultAssignee, w.ruleUser));
  });

  // T041 / F079
  it('a replayed handoff and a repeated delivery notify no one again', async () => {
    const w = await world();
    const ticketId = await ticket(w);
    const announced: string[] = [];
    const unregister = registerCoManagedSeatHandoffListener('t041', (receipt) => { announced.push(receipt.operationId); });
    const unregisterFailing = registerCoManagedSeatHandoffListener('t041-failing', () => { throw new Error('delivery is down'); });
    try {
      const handoff = { ...request(w, ticketId, w.staff, 0), technicianUserId: w.technician };
      // A failing listener never fails the handoff.
      const first = await handCoManagedSeatTicketToClientIt(db, handoff);
      const replay = await handCoManagedSeatTicketToClientIt(db, handoff);
      expect(replay).toEqual(first);
      // Announced once, for the recorded handoff; the replay announces nothing.
      expect(announced).toEqual([first.operationId]);

      expect(await deliver(w, first)).toEqual([w.technician]);
      expect(await deliver(w, first)).toEqual([]);
      expect(await told(w, TO_CLIENT_IT)).toEqual([w.technician]);
    } finally {
      unregister();
      unregisterFailing();
    }
  });

  // T041 / F079, F081
  it('nothing is notified when the gate is closed for the tenant', async () => {
    delete process.env[FORCE];
    const w = await world();
    const ticketId = await ticket(w, { assignedTo: w.technician });
    const receipt = await handCoManagedSeatTicketToClientIt(db, { ...request(w, ticketId, w.staff, 0), technicianUserId: w.technician });
    const lookup = { sponsorTenant: w.sponsor, operationId: receipt.operationId };

    // The kill switch, a malformed force value, and rollout targeting that names another tenant.
    for (const [key, value] of [[FORCE, 'co-managed-seat:off'], [FORCE, 'co-managed-seat:maybe'], [TARGETING, randomUUID()]] as const) {
      process.env[key] = value;
      expect(await resolveCoManagedSeatHandoffNotice(db, lookup), `${key}=${value}`).toBeNull();
      expect(await deliver(w, receipt), `${key}=${value}`).toEqual([]);
      const { commentId } = await comment(w, ticketId, w.staff, 'shared_it');
      expect(await resolveCoManagedSeatSharedNoteRecipients(db, { tenant: w.sponsor, ticketId, commentId, authorUserId: w.staff }), `${key}=${value}`).toEqual([]);
      delete process.env[key];
    }
    expect(await db('internal_notifications').where({ tenant: w.sponsor })).toHaveLength(0);

    // Targeting that names this tenant, and the force-on key, serve it.
    for (const [key, value] of [[TARGETING, w.sponsor], [FORCE, 'co-managed-seat:on']] as const) {
      process.env[key] = value;
      expect((await resolveCoManagedSeatHandoffNotice(db, lookup))?.recipients, `${key}=${value}`).toEqual([w.technician]);
      delete process.env[key];
    }
  });

  it('an existing arrangement does not enable notifications without an explicit rollout opt-in', async () => {
    delete process.env[FORCE];
    delete process.env[TARGETING];
    const w = await world();
    const ticketId = await ticket(w, { assignedTo: w.technician });
    const receipt = await handCoManagedSeatTicketToClientIt(db, {
      ...request(w, ticketId, w.staff, 0), technicianUserId: w.technician,
    });

    expect(await deliver(w, receipt)).toEqual([]);
    await comment(w, ticketId, w.staff, 'shared_it');
    expect(await db('internal_notifications').where({ tenant: w.sponsor })).toHaveLength(0);

    process.env[TARGETING] = w.sponsor;
    expect(await deliver(w, receipt)).toEqual([w.technician]);
    await comment(w, ticketId, w.staff, 'shared_it');
    expect(await told(w, COMMENT)).toEqual([w.technician]);
  });

  // T041 / F079
  it('a handoff under an arrangement that has ended, and a ticket of a client with none, notify no one', async () => {
    const w = await world();
    const ticketId = await ticket(w);
    const receipt = await handCoManagedSeatTicketToClientIt(db, request(w, ticketId, w.staff, 0));
    await db('co_managed_seat_arrangements').where({ tenant: w.sponsor, arrangement_id: w.arrangementId }).update({ state: 'ended', ended_at: new Date() });

    expect(await deliver(w, receipt)).toEqual([]);
    expect(await db('internal_notifications').where({ tenant: w.sponsor })).toHaveLength(0);
    expect(await resolveCoManagedSeatHandoffNotice(db, { sponsorTenant: w.sponsor, operationId: randomUUID() })).toBeNull();
  });

  // T041 / F081
  it('a shared IT note by MSP staff notifies the client\'s technicians on the ticket and no one else', async () => {
    const w = await world();
    const ticketId = await ticket(w, { assignedTo: w.technician });
    // Other MSP staff take part too; they are the author's own organization.
    await db('ticket_resources').insert({ tenant: w.sponsor, ticket_id: ticketId, assigned_to: w.technician, additional_user_id: w.bystander, role: 'support', assigned_at: new Date() });

    const { notify } = await comment(w, ticketId, w.staff, 'shared_it');

    // Not the other technician (not on the ticket), not MSP staff on it, not the author.
    expect(await told(w, COMMENT)).toEqual([w.technician]);

    // The same event delivered again notifies no one again.
    await notify();
    expect(await told(w, COMMENT)).toEqual([w.technician]);
  });

  // T041 / F081
  it('a shared IT note by a technician notifies the MSP staff on the ticket and no one else', async () => {
    const w = await world();
    const ticketId = await ticket(w, { assignedTo: w.bystander });
    // The MSP hands it over and later comments; the other technician joins as an additional agent.
    await toClientIt(w, ticketId, 0);
    await comment(w, ticketId, w.dispatcher, 'organization_private');
    await db('ticket_resources').insert({ tenant: w.sponsor, ticket_id: ticketId, assigned_to: w.bystander, additional_user_id: w.otherTechnician, role: 'support', assigned_at: new Date() });
    await clear(w);

    await comment(w, ticketId, w.technician, 'shared_it');

    // The MSP assignee, the MSP commenter and the MSP staff who handed it off. Not the other
    // technician (the author's own organization), not uninvolved staff, not the author.
    expect(await told(w, COMMENT)).toEqual(sorted(w.bystander, w.dispatcher, w.staff));
  });

  // T041 / F081
  it('a private note, a note on an unarranged client\'s ticket and a board out of scope notify no technician', async () => {
    const w = await world();
    const ticketId = await ticket(w, { assignedTo: w.technician });

    await comment(w, ticketId, w.staff, 'organization_private');
    expect(await told(w, COMMENT)).toEqual([]);

    // A client with no arrangement has no shared IT audience at all: the internal note is private.
    const unarranged = await ticket(w, { clientId: await createClient(db, w.sponsor, 'No arrangement'), assignedTo: w.bystander });
    await comment(w, unarranged, w.staff, 'organization_private');
    expect(await told(w, COMMENT)).toEqual([]);

    // The board leaves the arrangement's scope: its technicians can no longer open the ticket.
    const { commentId } = await comment(w, ticketId, w.staff, 'shared_it');
    expect(await told(w, COMMENT)).toEqual([w.technician]);
    await setCoManagedSeatBoardScope(db, { sponsorTenant: w.sponsor, arrangementId: w.arrangementId, boards: [{ boardId: w.plain, canCreate: true }] });
    expect(await resolveCoManagedSeatSharedNoteRecipients(db, { tenant: w.sponsor, ticketId, commentId, authorUserId: w.staff })).toEqual([]);
  });
});
