import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import type { SendEmailParams } from '../../../lib/notifications/sendEventEmail';

// Drives handleTicketClosed end-to-end over a fake tenantDb facade so the
// closed-ticket detail contract (delivery into send contexts, per-client
// hour-block memoization, non-fatal builder failures) is proven behaviorally
// rather than by grepping the subscriber source.

const state = vi.hoisted(() => ({
  materials: [] as Record<string, unknown>[],
  materialsFail: false,
  hours: vi.fn(),
  sends: [] as any[],
  locales: {} as Record<string, 'en' | 'de' | 'fr'>,
  localeCalls: [] as Array<{ to: string; recipientUserId?: string; recipientClientId?: string }>,
  assignee: {} as Record<string, string>,
  seats: [] as Array<Record<string, unknown>>,
  resolution: null as Record<string, unknown> | null,
  failAddress: null as string | null,
  notificationsDisabled: false,
  enqueue: vi.fn(async (_params: SendEmailParams, _options: { retryAfterMs?: number }) => undefined),
}));

vi.mock('@alga-psa/shared/billingClients/hourBlockService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/shared/billingClients/hourBlockService')>()),
  getAvailableHourBlockMinutes: state.hours,
}));

const fakeKnex = { raw: (sql: string) => sql } as unknown as Knex;

const MASTER_ROW = {
  ticket_id: 'ticket-master',
  ticket_number: 101,
  title: 'Printer is down',
  attributes: {},
  email_metadata: null,
  client_id: 'client-1',
  client_name: 'Acme',
  contact_name_id: 'contact-1',
  contact_name: 'Rosa',
  contact_email: 'requester@example.com',
  contact_phone: null,
  assigned_to: null,
};
const CHILD_ROWS = [{
  ticket_id: 'ticket-child-1',
  ticket_number: 102,
  client_id: 'client-1',
  client_name: 'Acme',
  contact_name_id: 'contact-2',
  contact_name: 'Kim',
  contact_email: 'child1@example.com',
  contact_phone: null,
  email_metadata: null,
}];
// Detail rows are keyed by ticket ID so a child send can only show its own rows.
const TIME_ROWS = [{
  ticket_id: 'ticket-master',
  entry_id: 'entry-1',
  start_time: '2025-06-10T09:00:00Z',
  end_time: '2025-06-10T10:30:00Z',
  billable_duration: 90,
  technician_name: 'Jane Smith',
}, {
  ticket_id: 'ticket-child-1',
  entry_id: 'entry-2',
  start_time: '2025-06-11T13:00:00Z',
  end_time: '2025-06-11T13:45:00Z',
  billable_duration: 30,
  technician_name: 'Alex Doe',
}];

function rowsFor(table: string, criteria: unknown, ticketIds: string[]): unknown[] {
  if (table === 'tickets as t') {
    const where = (criteria ?? {}) as Record<string, unknown>;
    if ('t.ticket_id' in where) return [{ ...MASTER_ROW, ...state.assignee }];
    if ('t.master_ticket_id' in where) return CHILD_ROWS;
    return [];
  }
  if (table === 'ticket_materials as tm') {
    if (state.materialsFail) throw new Error('Material lookup unavailable');
    return state.materials.filter((row) => ticketIds.includes(row.ticket_id as string));
  }
  if (table === 'time_entries as te') return TIME_ROWS.filter((row) => ticketIds.includes(row.ticket_id));
  if (table === 'co_managed_seat_assignments as sa') return state.seats;
  if (table === 'comments') return state.resolution ? [state.resolution] : [];
  if (table === 'notification_settings' && state.notificationsDisabled) return [{ is_enabled: false }];
  if (table === 'notification_subtypes') return [{ id: 1, category_id: 1 }];
  return [];
}

function makeBuilder(table: string) {
  let criteria: unknown = {};
  let ticketIds: string[] = [];
  const rows = () => rowsFor(table, criteria, ticketIds);
  const builder: any = {
    select: () => builder,
    where: (added: unknown) => {
      criteria = { ...(criteria as object), ...(added as object) };
      return builder;
    },
    whereIn: (_column: string, ids: string[]) => {
      ticketIds = ids;
      return builder;
    },
    whereNot: () => builder,
    andWhere: () => builder,
    // The builder is itself thenable, so it works both when awaited directly
    // and when knex-style terminators are chained after it.
    orderBy: () => builder,
    first: () => Promise.resolve(rows()[0]),
    insert: () => Promise.resolve(),
    then: (onOk: (rows: unknown[]) => unknown, onErr?: (error: unknown) => unknown) =>
      Promise.resolve(rows()).then(onOk, onErr),
  };
  return builder;
}

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  tenantDb: () => ({
    table: (table: string) => makeBuilder(table),
    unscoped: (table: string) => makeBuilder(table),
    tenantJoin: () => undefined,
  }),
  getConnection: async () => fakeKnex,
  createTenantKnex: async (tenant?: string) => ({ knex: fakeKnex, tenant }),
}));
vi.mock('../../../lib/db/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/db/db')>()),
  getConnection: async () => fakeKnex,
}));
vi.mock('../../../lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/db')>()),
  createTenantKnex: async (tenant?: string) => ({ knex: fakeKnex, tenant }),
}));
vi.mock('../../../lib/notifications/sendEventEmail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/notifications/sendEventEmail')>()),
  sendEventEmail: vi.fn(async (params: any) => {
    if (state.failAddress === params.to) {
      state.failAddress = null;
      state.notificationsDisabled = false;
      throw Object.assign(new Error('Temporary provider failure'), {
        name: 'EmailProviderError', isRetryable: true, metadata: { retryAfterMs: 1200 },
      });
    }
    state.sends.push(params);
    return true;
  }),
  resolveEventEmailLocale: vi.fn(async (params: { to: string; locale?: 'en' | 'de' | 'fr'; recipientUserId?: string; recipientClientId?: string }) => {
    state.localeCalls.push(params);
    return params.locale ?? state.locales[params.to] ?? 'en';
  }),
}));
vi.mock('../../../lib/notifications/EventEmailRetryQueue', () => ({
  EventEmailRetryQueue: {
    getInstance: () => ({ isReady: () => true, enqueue: state.enqueue }),
  },
}));

let handleTicketClosed: (event: any) => Promise<void>;

// Portal link building validates the tenant is a UUID, so the fixture uses one.
const TENANT = '11111111-1111-4111-8111-111111111111';

function closedEvent(): any {
  return {
    id: 'event-1',
    eventType: 'TICKET_CLOSED',
    payload: {
      tenantId: TENANT,
      ticketId: 'ticket-master',
      suppressInternalNotifications: true,
    },
  };
}

describe('ticket closed email detail delivery', () => {
  beforeAll(async () => {
    ({ ticketEmailSubscriberTestHarness: { handleTicketClosed } } = await import(
      '../../../lib/eventBus/subscribers/ticketEmailSubscriber'
    ));
  });

  beforeEach(() => {
    state.materials = [
      { ticket_id: 'ticket-master', item_name: 'Toner', description: 'Black', quantity: 2, rate: 4500, currency_code: 'USD', is_billed: true },
      { ticket_id: 'ticket-child-1', item_name: 'Cable', description: 'USB-C', quantity: 1, rate: 1500, currency_code: 'USD', is_billed: false },
    ];
    state.materialsFail = false;
    state.hours.mockClear();
    state.hours.mockResolvedValue(765);
    state.sends.length = 0;
    state.locales = {};
    state.localeCalls.length = 0;
    state.assignee = {};
    state.seats = [];
    state.resolution = null;
    state.failAddress = null;
    state.notificationsDisabled = false;
    state.enqueue.mockClear();
  });

  it('formats master, child and internal sends for each actual recipient without exposing materials to clients', async () => {
    state.locales = {
      'requester@example.com': 'de',
      'child1@example.com': 'fr',
      'tech@example.com': 'de',
    };
    state.assignee = {
      assigned_to: 'user-tech',
      assigned_to_name: 'Jane Smith',
      assigned_to_email: 'tech@example.com',
    };
    const event = closedEvent();
    event.payload.suppressInternalNotifications = false;
    await handleTicketClosed(event);

    const master = state.sends.find((send) => send.to === 'requester@example.com');
    const child = state.sends.find((send) => send.to === 'child1@example.com');
    const staff = state.sends.find((send) => send.to === 'tech@example.com');
    expect(master).toMatchObject({ locale: 'de', recipientClientId: 'client-1', template: 'ticket-closed-client' });
    expect(child).toMatchObject({ locale: 'fr', recipientClientId: 'client-1', template: 'ticket-closed-client' });
    expect(staff).toMatchObject({ locale: 'de', recipientUserId: 'user-tech', template: 'ticket-closed' });
    expect(master.context.ticket.timeEntries[0]).toMatchObject({ date: '10.06.2025', worked: '1 Std., 30 Min.' });
    expect(child.context.ticket.timeEntries[0].date).toBe('11/06/2025');
    expect(child.context.ticket.timeEntries[0].worked.replace(/\s/g, ' ')).toBe('0 h et 45 min');
    expect(master.context.ticket).not.toHaveProperty('materials');
    expect(child.context.ticket).not.toHaveProperty('materials');
    expect(staff.context.ticket.materials[0].rate.replace(/\s/g, ' ')).toBe('45,00 $');
    expect(staff).not.toHaveProperty('detailBlocksForLocale');
    expect(state.localeCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ to: 'requester@example.com', recipientClientId: 'client-1' }),
      expect.objectContaining({ to: 'child1@example.com', recipientClientId: 'client-1' }),
      expect.objectContaining({ to: 'tech@example.com', recipientUserId: 'user-tech' }),
    ]));
    expect(state.hours).toHaveBeenCalledTimes(1);
  });

  it('formats a split out-of-scope seat recipient in their own locale and applies the client projection', async () => {
    state.locales = { 'requester@example.com': 'en', 'seat@example.com': 'de' };
    state.seats = [{
      user_id: 'seat-user', email: 'seat@example.com', assignment_state: 'active',
      arrangement_id: 'arrangement-1', arrangement_state: 'active', client_id: 'another-client',
    }];
    state.resolution = {
      comment_id: 'resolution-1',
      is_internal: false,
      note: 'Resolved',
      metadata: { closes_ticket: true, email_recipients: { bcc: [{ email: 'seat@example.com' }] } },
    };

    await handleTicketClosed(closedEvent());

    const requester = state.sends.find((send) => send.to === 'requester@example.com');
    const seat = state.sends.find((send) => send.to === 'seat@example.com');
    expect(requester.locale).toBe('en');
    expect(requester.bcc ?? []).not.toContainEqual({ email: 'seat@example.com' });
    expect(seat).toMatchObject({
      locale: 'de', recipientUserId: 'seat-user', template: 'ticket-closed-client',
      context: { recipient: { isInternal: false } },
    });
    expect(seat).not.toHaveProperty('contactId');
    expect(seat.context.ticket).not.toHaveProperty('materials');
    expect(seat.context.ticket.timeEntries[0]).toMatchObject({ date: '10.06.2025', worked: '1 Std., 30 Min.' });
    expect(seat.context.ticket.url).toContain('/client-portal/tickets/');
    expect(seat.replyContext.tokenMetadata.notificationAudience).toBe('requester');
  });

  it('logs a formatting failure and keeps other ticket emails with localized empty details', async () => {
    state.materials[0].currency_code = 'INVALID';
    state.locales = { 'requester@example.com': 'de', 'child1@example.com': 'fr' };
    const warning = vi.spyOn(logger, 'warn');
    try {
      await handleTicketClosed(closedEvent());
      const master = state.sends.find((send) => send.to === 'requester@example.com');
      const child = state.sends.find((send) => send.to === 'child1@example.com');
      expect(master.context.ticket.timeEntries).toEqual([]);
      expect(master.context.ticket.totalTimeWorked).toBe('0 Std.');
      expect(child.context.ticket.timeEntries[0].date).toBe('11/06/2025');
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining('Failed to build ticket email detail blocks'),
        expect.objectContaining({ ticketId: 'ticket-master', tenantId: TENANT }),
      );
    } finally {
      warning.mockRestore();
    }
  });

  it('sends close emails to the requester and bundled child sends with client-safe details kept and MSP-only details projected out, looking up hour blocks once per client', async () => {
    await handleTicketClosed(closedEvent());

    // Client-addressed sends render under the client template variant. The
    // work-history blocks (time entries and their totals) are client-facing,
    // while material rates and billed state stay MSP-only and are projected
    // out of the client rendering.
    const contactSends = state.sends.filter((send) => send.template === 'ticket-closed-client');
    expect(contactSends.map((send) => send.to)).toEqual([
      'requester@example.com',
      'child1@example.com',
    ]);

    for (const send of contactSends) {
      expect(send.context.ticket).toHaveProperty('timeEntries');
      expect(send.context.ticket).toHaveProperty('totalTimeWorked');
      expect(send.context.ticket).toHaveProperty('totalTimeBillable');
      expect(send.context.ticket).not.toHaveProperty('materials');
      expect(send.context.ticket).not.toHaveProperty('materialsTotal');
    }
    expect(contactSends[1].context.ticket.id).toBe(102);

    // The blocks are still built per client: master and child share client-1,
    // so the memoized hour-block resolver runs once.
    expect(state.hours).toHaveBeenCalledTimes(1);
    expect(state.hours).toHaveBeenCalledWith(expect.anything(), TENANT, 'client-1');
  });

  it('queues a retry with localized, client-projected and serializable details', async () => {
    state.locales = { 'requester@example.com': 'de', 'child1@example.com': 'fr' };
    state.failAddress = 'requester@example.com';
    await handleTicketClosed(closedEvent());

    expect(state.enqueue).toHaveBeenCalledTimes(1);
    const [queued, options] = state.enqueue.mock.calls[0];
    expect(options).toEqual({ retryAfterMs: 1200 });
    expect(queued).toMatchObject({
      to: 'requester@example.com', locale: 'de', template: 'ticket-closed-client',
      context: { recipient: { isInternal: false } },
    });
    expect(queued).not.toHaveProperty('detailBlocksForLocale');
    expect(queued).not.toHaveProperty('audienceContent');
    expect(queued.context.ticket).not.toHaveProperty('materials');
    expect(queued.context.ticket).toMatchObject({
      timeEntries: [expect.objectContaining({ date: '10.06.2025', worked: '1 Std., 30 Min.' })],
    });
    expect(JSON.parse(JSON.stringify(queued))).toEqual(queued);
    expect(state.sends.find((send) => send.to === 'child1@example.com').locale).toBe('fr');
  });

  it('does not send or queue when notifications are disabled', async () => {
    state.notificationsDisabled = true;
    const event = closedEvent();
    event.payload.tenantId = '22222222-2222-4222-8222-222222222222';
    await handleTicketClosed(event);
    expect(state.sends).toEqual([]);
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it('still sends the close emails when the detail build fails', async () => {
    state.materialsFail = true;
    state.locales = { 'requester@example.com': 'de' };
    const warning = vi.spyOn(logger, 'warn');
    try {
      await handleTicketClosed(closedEvent());

      const contactSends = state.sends.filter((send) => send.template === 'ticket-closed-client');
      expect(contactSends.map((send) => send.to)).toEqual([
        'requester@example.com',
        'child1@example.com',
      ]);
      for (const send of contactSends) {
        expect(send.context.ticket).not.toHaveProperty('materials');
        expect(send.context.ticket.timeEntries).toEqual([]);
      }
      expect(contactSends[0].context.ticket.totalTimeWorked).toBe('0 Std.');
      expect(contactSends[1].context.ticket.totalTimeWorked).toBe('0 hr');
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch ticket email detail rows'),
        expect.objectContaining({ ticketId: 'ticket-master', tenantId: TENANT }),
      );
    } finally {
      warning.mockRestore();
    }
  });
});
