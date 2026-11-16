import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant, tenantDb } from '@alga-psa/db';
import { TicketModel } from '@alga-psa/shared/models/ticketModel';
import { ticketVariableAudience } from '@alga-psa/notifications/lib/templateVariables/ticketEmailAudience';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

/**
 * Every ticket email knows its recipient's audience. The real handlers run over real rows; only
 * the mail transport is replaced, and it records the template and context each recipient is
 * handed: the client side gets `recipient.isInternal = false`, the client template where one
 * exists and client-safe variables only; staff get `true` and the whole context.
 */
type Sent = { to: string; template: string; context: any; notificationSubtypeId?: number };
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
    sent.push({ to: params.to, template: params.template, context: params.context, notificationSubtypeId: params.notificationSubtypeId });
  }),
}));

const CONTACT_EMAIL = 'casey.contact@client.example.com';
const ASSIGNEE_EMAIL = 'avery.assignee@msp.example.com';
const AUTHOR_EMAIL = 'morgan.author@msp.example.com';
const STAFF_WATCHER_EMAIL = 'sam.watcher@msp.example.com';
const OUTSIDE_WATCHER_EMAIL = 'vendor@elsewhere.example.com';

const note = (text: string) => JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }]);

describe('ticket email audience split (integration)', () => {
  let handlers: {
    handleTicketCreated: (event: any) => Promise<void>;
    handleTicketUpdated: (event: any) => Promise<void>;
    handleTicketAssigned: (event: any) => Promise<void>;
    handleTicketCommentAdded: (event: any) => Promise<void>;
    handleTicketClosed: (event: any) => Promise<void>;
  };

  interface Desk { tenant: string; assignee: string; author: string; createTicket: (extra?: Record<string, unknown>) => Promise<string> }

  /** One MSP tenant with a client contact, an assignee, a comment author and a staff watcher. */
  async function seedDesk(): Promise<Desk> {
    const tenant = await createTenant(testDb, `Audience ${uuidv4().slice(0, 6)}`);
    const scoped = tenantDb(testDb, tenant);
    const clientId = await createClient(testDb, tenant, 'Audience Client');
    const assignee = await createUser(testDb, tenant, { email: ASSIGNEE_EMAIL });
    const author = await createUser(testDb, tenant, { email: AUTHOR_EMAIL });
    await createUser(testDb, tenant, { email: STAFF_WATCHER_EMAIL });
    const contactId = uuidv4();
    await scoped.table('contacts').insert({ tenant, contact_name_id: contactId, full_name: 'Casey Contact', email: CONTACT_EMAIL, client_id: clientId });
    const boardId = uuidv4();
    const statusId = uuidv4();
    const priorityId = uuidv4();
    await scoped.table('boards').insert({ tenant, board_id: boardId, board_name: 'Service Desk', is_default: true });
    await scoped.table('statuses').insert({ tenant, status_id: statusId, board_id: boardId, name: 'Open', status_type: 'ticket', item_type: 'ticket', order_number: 1, is_default: true, is_closed: false });
    await scoped.table('priorities').insert({ tenant, priority_id: priorityId, priority_name: 'Medium', item_type: 'ticket', order_number: 1, color: '#ccc', created_by: assignee });
    const createTicket = async (extra: Record<string, unknown> = {}) => {
      const ticketId = uuidv4();
      await scoped.table('tickets').insert({
        tenant, ticket_id: ticketId, ticket_number: `T-${uuidv4().slice(0, 6)}`, title: 'Printer offline',
        client_id: clientId, board_id: boardId, status_id: statusId, priority_id: priorityId,
        contact_name_id: contactId, assigned_to: assignee,
        // Older than the creation window, so an assignment is not folded into the created email.
        entered_at: new Date(Date.now() - 10 * 60_000),
        attributes: { watch_list: [
          { email: STAFF_WATCHER_EMAIL, active: true },
          { email: OUTSIDE_WATCHER_EMAIL, active: true },
        ] },
        ...extra,
      });
      return ticketId;
    };
    return { tenant, assignee, author, createTicket };
  }

  let desk: Desk;

  beforeAll(async () => {
    testDb = await createTestDbConnection();
    ({ ticketEmailSubscriberTestHarness: handlers } = await import('../../lib/eventBus/subscribers/ticketEmailSubscriber'));
    desk = await seedDesk();
  }, 900_000);

  afterAll(async () => {
    await testDb?.destroy();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  const event = (tenant: string, eventType: string, ticketId: string, extra: Record<string, unknown> = {}) => ({
    id: uuidv4(),
    eventType,
    timestamp: new Date().toISOString(),
    payload: { tenantId: tenant, ticketId, occurredAt: new Date().toISOString(), actorType: 'SYSTEM', ...extra },
  });
  const mailTo = (address: string) => {
    const mails = sent.filter((mail) => mail.to.toLowerCase() === address);
    expect(mails, `one message to ${address}`).toHaveLength(1);
    return mails[0];
  };
  /**
   * The client rendering is built from client-safe variables only. Every client-audience
   * variable the handlers send must appear in a client copy exactly as it does in a staff
   * copy: one missing here was dropped by the classification and now renders empty.
   * MSP-audience variables (material rates and billed state) may be absent by design.
   */
  const expectNoTicketVariableLost = () => {
    const clientSafe = (keys: string[]) => keys.filter((key) => ticketVariableAudience(`ticket.${key}`) === 'client').sort();
    const staff = clientSafe(Object.keys(mailTo(ASSIGNEE_EMAIL).context.ticket));
    expect(clientSafe(Object.keys(mailTo(CONTACT_EMAIL).context.ticket))).toEqual(staff);
    expect(clientSafe(Object.keys(mailTo(OUTSIDE_WATCHER_EMAIL).context.ticket))).toEqual(staff);
  };
  const audienceOf = () => Object.fromEntries(sent.map((mail) => [mail.to.toLowerCase(), {
    template: mail.template, isInternal: mail.context.recipient?.isInternal,
  }]));

  it('ticket created: the client side gets the client template, staff the internal one, each with its audience', async () => {
    const ticketId = await desk.createTicket();
    await runWithTenant(desk.tenant, () => handlers.handleTicketCreated(event(desk.tenant, 'TICKET_CREATED', ticketId)));

    expect(audienceOf()).toEqual({
      [CONTACT_EMAIL]: { template: 'ticket-created-client', isInternal: false },
      [OUTSIDE_WATCHER_EMAIL]: { template: 'ticket-created-client', isInternal: false },
      [ASSIGNEE_EMAIL]: { template: 'ticket-created', isInternal: true },
      [STAFF_WATCHER_EMAIL]: { template: 'ticket-created', isInternal: true },
    });
    expect(mailTo(CONTACT_EMAIL).context.ticket.url).toContain('/client-portal/tickets/');
    expect(mailTo(ASSIGNEE_EMAIL).context.ticket.url).toContain('/msp/tickets/');
    expectNoTicketVariableLost();
  });

  it('ticket updated: the same split, decided once', async () => {
    const ticketId = await desk.createTicket();
    await runWithTenant(desk.tenant, () => handlers.handleTicketUpdated(event(desk.tenant, 'TICKET_UPDATED', ticketId, {
      changes: { title: { old: 'Printer', new: 'Printer offline' } },
    })));

    expect(audienceOf()).toEqual({
      [CONTACT_EMAIL]: { template: 'ticket-updated-client', isInternal: false },
      [OUTSIDE_WATCHER_EMAIL]: { template: 'ticket-updated-client', isInternal: false },
      [ASSIGNEE_EMAIL]: { template: 'ticket-updated', isInternal: true },
      [STAFF_WATCHER_EMAIL]: { template: 'ticket-updated', isInternal: true },
    });
    expectNoTicketVariableLost();
  });

  it('a client-facing subtype switched off silences the client side only', async () => {
    const other = await seedDesk();
    const scoped = tenantDb(testDb, other.tenant);
    const subtype = await scoped.table('notification_subtypes').where({ name: 'Ticket Created Client' }).first('id');
    await scoped.table('tenant_notification_subtype_settings').insert({ tenant: other.tenant, subtype_id: subtype.id, is_enabled: false });
    const ticketId = await other.createTicket();

    await runWithTenant(other.tenant, () => handlers.handleTicketCreated(event(other.tenant, 'TICKET_CREATED', ticketId)));

    expect(sent.map((mail) => mail.to.toLowerCase()).sort()).toEqual([ASSIGNEE_EMAIL, STAFF_WATCHER_EMAIL].sort());
  });

  it('team assignment: watchers are told apart, staff with the MSP link', async () => {
    const scoped = tenantDb(testDb, desk.tenant);
    const teamId = uuidv4();
    await scoped.table('teams').insert({ tenant: desk.tenant, team_id: teamId, team_name: 'Network Team', manager_id: desk.assignee });
    const ticketId = await desk.createTicket({ assigned_to: null, assigned_team_id: teamId });

    await runWithTenant(desk.tenant, () => handlers.handleTicketAssigned(event(desk.tenant, 'TICKET_ASSIGNED', ticketId, {
      changes: { assigned_team_id: { old: null, new: teamId } }, assignedTeamId: teamId,
    })));

    const audiences = audienceOf();
    expect(audiences[CONTACT_EMAIL]).toEqual({ template: 'ticket-team-assigned', isInternal: false });
    expect(audiences[OUTSIDE_WATCHER_EMAIL]).toEqual({ template: 'ticket-team-assigned', isInternal: false });
    expect(audiences[STAFF_WATCHER_EMAIL]).toEqual({ template: 'ticket-team-assigned', isInternal: true });
    expect(mailTo(STAFF_WATCHER_EMAIL).context.ticket.url).toContain('/msp/tickets/');
    expect(mailTo(OUTSIDE_WATCHER_EMAIL).context.ticket.url).toContain('/client-portal/tickets/');
  });

  /** A public reply by an MSP agent on a ticket of `target`, delivered through the real handler. */
  async function publicReply(target: Desk, text: string): Promise<void> {
    const ticketId = await target.createTicket();
    const content = note(text);
    const created = await testDb.transaction((trx) => TicketModel.createComment({
      ticket_id: ticketId, content, author_type: 'internal', author_id: target.author, is_internal: false,
    } as any, target.tenant, trx));

    await runWithTenant(target.tenant, () => handlers.handleTicketCommentAdded(event(target.tenant, 'TICKET_COMMENT_ADDED', ticketId, {
      userId: target.author, actorUserId: target.author, actorType: 'USER',
      // `authorType` is not a classified variable: it must not reach the client side.
      comment: { id: created.comment_id, content, author: 'Morgan Author', isInternal: false, authorType: 'internal' },
    })));
  }

  it('comment added: the client side gets the client template and client-safe variables only', async () => {
    await publicReply(desk, 'AUDIENCE-PUBLIC-REPLY');

    expect(audienceOf()).toEqual({
      [CONTACT_EMAIL]: { template: 'ticket-comment-added-client', isInternal: false },
      [OUTSIDE_WATCHER_EMAIL]: { template: 'ticket-comment-added-client', isInternal: false },
      [ASSIGNEE_EMAIL]: { template: 'ticket-comment-added', isInternal: true },
      [STAFF_WATCHER_EMAIL]: { template: 'ticket-comment-added', isInternal: true },
    });
    const contact = mailTo(CONTACT_EMAIL);
    expect(contact.context.recipient).toEqual({ isInternal: false });
    expect(JSON.stringify(contact.context)).toContain('AUDIENCE-PUBLIC-REPLY');
    expect(contact.context.comment.author).toBe('Morgan Author');
    expect(contact.context.comment).not.toHaveProperty('authorType');
    expect(contact.context.ticket.url).toContain('/client-portal/tickets/');
    expect(mailTo(OUTSIDE_WATCHER_EMAIL).context.recipient).toEqual({ isInternal: false });

    const assignee = mailTo(ASSIGNEE_EMAIL);
    expect(assignee.context.recipient).toEqual({ isInternal: true });
    expect(assignee.context.comment.authorType).toBe('internal');
    expectNoTicketVariableLost();
    // The one comment variable clients lose is the unclassified one.
    expect(Object.keys(assignee.context.comment).filter((key) => !(key in contact.context.comment))).toEqual(['authorType']);
    expect(assignee.context.ticket.url).toContain('/msp/tickets/');
    expect(mailTo(STAFF_WATCHER_EMAIL).context.recipient).toEqual({ isInternal: true });
  });

  describe('the internal and the client comment email are switched separately', () => {
    const subtypeId = async (tenant: string, name: string) =>
      (await tenantDb(testDb, tenant).table('notification_subtypes').where({ name }).first('id')).id as number;
    const switchOff = async (tenant: string, name: string) =>
      tenantDb(testDb, tenant).table('tenant_notification_subtype_settings')
        .insert({ tenant, subtype_id: await subtypeId(tenant, name), is_enabled: false });
    const recipients = () => sent.map((mail) => mail.to.toLowerCase()).sort();

    it('the internal one off: clients are still mailed', async () => {
      const other = await seedDesk();
      await switchOff(other.tenant, 'Ticket Comment Added');

      await publicReply(other, 'AUDIENCE-CLIENT-ONLY');

      expect(recipients()).toEqual([CONTACT_EMAIL, OUTSIDE_WATCHER_EMAIL].sort());
    });

    it('the client one off: staff are still mailed', async () => {
      const other = await seedDesk();
      await switchOff(other.tenant, 'Ticket Comment Added Client');

      await publicReply(other, 'AUDIENCE-STAFF-ONLY');

      expect(recipients()).toEqual([ASSIGNEE_EMAIL, STAFF_WATCHER_EMAIL].sort());
    });

    it('both off, as the split migration leaves a tenant that had the shared email off: nobody is mailed', async () => {
      const other = await seedDesk();
      await switchOff(other.tenant, 'Ticket Comment Added');
      await switchOff(other.tenant, 'Ticket Comment Added Client');

      await publicReply(other, 'AUDIENCE-SWITCHED-OFF');

      expect(sent).toEqual([]);
    });
  });

  it('ticket closed: the client side gets the client template, and the audience is on every copy', async () => {
    const ticketId = await desk.createTicket();
    await runWithTenant(desk.tenant, () => handlers.handleTicketClosed(event(desk.tenant, 'TICKET_CLOSED', ticketId, {
      userId: desk.author, actorUserId: desk.author, actorType: 'USER',
    })));

    expect(audienceOf()).toEqual({
      [CONTACT_EMAIL]: { template: 'ticket-closed-client', isInternal: false },
      [OUTSIDE_WATCHER_EMAIL]: { template: 'ticket-closed-client', isInternal: false },
      [ASSIGNEE_EMAIL]: { template: 'ticket-closed', isInternal: true },
      [STAFF_WATCHER_EMAIL]: { template: 'ticket-closed', isInternal: true },
    });
    expect(mailTo(CONTACT_EMAIL).context.ticket.closedBy).not.toBe('');
    expectNoTicketVariableLost();
  });
});
