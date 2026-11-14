import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

// Drives handleTicketClosed end-to-end over a fake tenantDb facade so the
// closed-ticket detail contract (delivery into send contexts, per-client
// hour-block memoization, non-fatal builder failures) is proven behaviorally
// rather than by grepping the subscriber source.

const state = vi.hoisted(() => ({
  materials: [] as Record<string, unknown>[],
  materialsFail: false,
  hours: vi.fn(),
  sends: [] as any[],
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
    if ('t.ticket_id' in where) return [MASTER_ROW];
    if ('t.master_ticket_id' in where) return CHILD_ROWS;
    return [];
  }
  if (table === 'ticket_materials as tm') {
    if (state.materialsFail) throw new Error('Material lookup unavailable');
    return state.materials.filter((row) => ticketIds.includes(row.ticket_id as string));
  }
  if (table === 'time_entries as te') return TIME_ROWS.filter((row) => ticketIds.includes(row.ticket_id));
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
    state.sends.push(params);
    return true;
  }),
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
  });

  it('delivers detail blocks to the requester and bundled child sends, looking up hour blocks once per client', async () => {
    await handleTicketClosed(closedEvent());

    const contactSends = state.sends.filter((send) => send.template === 'ticket-closed');
    expect(contactSends.map((send) => send.to)).toEqual([
      'requester@example.com',
      'child1@example.com',
    ]);

    const master = contactSends[0].context.ticket;
    expect(master.timeEntries).toEqual([
      { date: '06/10/2025', technician: 'Jane Smith', worked: '1 hr 30 min', billable: '1 hr 30 min' },
    ]);
    expect(master.materials).toHaveLength(1);
    expect(master.materialsTotal).toBe('$90.00');
    expect(master.totalTimeWorked).toBe('1 hr 30 min');
    expect(master.remainingBlockHours).toBe('12 hrs 45 min');

    const child = contactSends[1].context.ticket;
    expect(child.id).toBe(102);
    expect(child.timeEntries).toEqual([
      { date: '06/11/2025', technician: 'Alex Doe', worked: '0 hrs 45 min', billable: '0 hrs 30 min' },
    ]);
    expect(child.materials).toEqual([expect.objectContaining({ name: 'Cable', amount: '$15.00' })]);
    expect(child.materialsTotal).toBe('$15.00');
    expect(child.totalTimeWorked).toBe('0 hrs 45 min');
    expect(child.remainingBlockHours).toBe('12 hrs 45 min');

    // Master and child share client-1, so the memoized resolver runs once.
    expect(state.hours).toHaveBeenCalledTimes(1);
    expect(state.hours).toHaveBeenCalledWith(expect.anything(), TENANT, 'client-1');
  });

  it('still sends the close emails with empty details when the detail build fails', async () => {
    state.materialsFail = true;

    await handleTicketClosed(closedEvent());

    const contactSends = state.sends.filter((send) => send.template === 'ticket-closed');
    expect(contactSends.map((send) => send.to)).toEqual([
      'requester@example.com',
      'child1@example.com',
    ]);
    for (const send of contactSends) {
      expect(send.context.ticket).toMatchObject({
        assets: [],
        materials: [],
        materialsTotal: '',
        timeEntries: [],
        totalTimeWorked: '0 hrs',
        totalTimeBillable: '0 hrs',
        remainingBlockHours: '0 hrs',
      });
    }
  });
});
