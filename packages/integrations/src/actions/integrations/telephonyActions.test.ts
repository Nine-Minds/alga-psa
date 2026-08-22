import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  type CallRecord = {
    tenant: string;
    call_record_id: string;
    matched_client_id: string | null;
    interaction_id: string | null;
    ticket_id: string | null;
  };

  type Interaction = { tenant: string; interaction_id: string; ticket_id: string | null };
  type Ticket = {
    tenant: string;
    ticket_id: string;
    ticket_number: string;
    title: string;
    client_id: string;
    status_id: string;
    entered_at: string;
  };
  type Status = { tenant: string; status_id: string; name: string; is_closed: boolean };

  const state = {
    mockUser: { user_id: 'user-1', user_type: 'internal' } as any,
    mockCtx: { tenant: 'tenant-1' } as any,
    calls: [] as CallRecord[],
    interactions: [] as Interaction[],
    tickets: [] as Ticket[],
    statuses: [] as Status[],
  };

  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

  const rowsFor = (table: string): Array<Record<string, unknown>> => {
    if (table.startsWith('telephony_call_records')) return state.calls as any;
    if (table.startsWith('interactions')) return state.interactions as any;
    if (table.startsWith('tickets')) return state.tickets as any;
    if (table.startsWith('statuses')) return state.statuses as any;
    return [];
  };

  const createQuery = (table: string) => {
    const equals: Record<string, unknown>[] = [];
    const columnFilters: Array<(row: any) => boolean> = [];

    const filtered = () =>
      rowsFor(table).filter((row) =>
        equals.every((cond) => Object.entries(cond).every(([k, v]) => row[k] === v)) &&
        columnFilters.every((fn) => fn(row))
      );

    const query: any = {
      where(conditions: any, value?: unknown) {
        if (typeof conditions === 'string') {
          const column = conditions.split('.').pop() as string;
          columnFilters.push((row) => row[column] === value);
        } else if (typeof conditions === 'function') {
          // andWhere-style callback: the open-status filter. Statuses are joined
          // in, so approximate it against the resolved status row.
          columnFilters.push((row) => {
            const status = state.statuses.find((s) => s.status_id === (row as any).status_id);
            return !status || status.is_closed === false;
          });
        } else {
          equals.push(conditions);
        }
        return query;
      },
      andWhere(conditions: any, value?: unknown) {
        return query.where(conditions, value);
      },
      orderBy() { return query; },
      limit() { return query; },
      async first(..._columns: unknown[]) {
        const [row] = filtered();
        return row ? clone(row) : undefined;
      },
      // knex's select is chainable; the builder executes when awaited.
      select(..._columns: unknown[]) { return query; },
      async update(values: Record<string, unknown>) {
        const rows = filtered();
        rows.forEach((row) => Object.assign(row, values));
        return rows.length;
      },
      then(resolve: (rows: unknown[]) => unknown, reject?: (reason: unknown) => unknown) {
        const rows = filtered().map((row) => {
          const copy: any = clone(row);
          const status = state.statuses.find((s) => s.status_id === copy.status_id);
          copy.status_name = status?.name ?? null;
          return copy;
        });
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return query;
  };

  const knexMock: any = ((table: string) => createQuery(table)) as any;
  knexMock.fn = { now: vi.fn(() => 'now()') };

  return {
    state,
    knexMock,
    hasPermissionMock: vi.fn(async (..._args: unknown[]) => true),
  };
});

const { calls, interactions, tickets, statuses } = hoisted.state;
const { hasPermissionMock } = hoisted;

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth:
    (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(hoisted.state.mockUser, hoisted.state.mockCtx, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hoisted.hasPermissionMock,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: hoisted.knexMock }),
  withTransaction: async (_knex: any, fn: (trx: any) => Promise<unknown>) => fn(hoisted.knexMock),
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => conn(table).where({ tenant }),
    tenantJoin: () => undefined,
  }),
}));

vi.mock('@alga-psa/shared/models/ticketModel', () => ({ TicketModel: {} }));

vi.mock('../../lib/telephonyAvailability', () => ({
  getTelephonyAvailability: async () => ({ enabled: true }),
  resolveTelephonyAvailability: () => ({ enabled: true }),
}));

import { linkTelephonyCallToTicket, listTelephonyLinkableTickets } from './telephonyActions';

describe('telephony link-to-ticket', () => {
  beforeEach(() => {
    calls.length = 0;
    interactions.length = 0;
    tickets.length = 0;
    statuses.length = 0;
    hasPermissionMock.mockClear();
    hasPermissionMock.mockResolvedValue(true);

    statuses.push(
      { tenant: 'tenant-1', status_id: 'status-open', name: 'Open', is_closed: false },
      { tenant: 'tenant-1', status_id: 'status-closed', name: 'Closed', is_closed: true },
    );
    tickets.push(
      {
        tenant: 'tenant-1', ticket_id: 'ticket-1', ticket_number: '1001', title: 'Printer down',
        client_id: 'client-1', status_id: 'status-open', entered_at: '2026-08-01T00:00:00Z',
      },
      {
        tenant: 'tenant-1', ticket_id: 'ticket-2', ticket_number: '1002', title: 'Old request',
        client_id: 'client-1', status_id: 'status-closed', entered_at: '2026-07-01T00:00:00Z',
      },
      {
        tenant: 'tenant-1', ticket_id: 'ticket-3', ticket_number: '1003', title: 'Other client',
        client_id: 'client-2', status_id: 'status-open', entered_at: '2026-08-02T00:00:00Z',
      },
    );
  });

  function addCall(overrides: Partial<(typeof calls)[number]> = {}) {
    const record = {
      tenant: 'tenant-1',
      call_record_id: 'call-1',
      matched_client_id: 'client-1',
      interaction_id: 'interaction-1',
      ticket_id: null,
      ...overrides,
    };
    calls.push(record);
    if (record.interaction_id) {
      interactions.push({ tenant: 'tenant-1', interaction_id: record.interaction_id, ticket_id: null });
    }
    return record;
  }

  it('T041: linking a call sets interactions.ticket_id and stamps the call record', async () => {
    addCall();

    const result = await linkTelephonyCallToTicket({ callRecordId: 'call-1', ticketId: 'ticket-1' });

    expect(result).toEqual({ success: true });
    expect(interactions[0].ticket_id).toBe('ticket-1');
    expect(calls[0].ticket_id).toBe('ticket-1');
  });

  it('T041: refuses to link a call that has not been attributed yet', async () => {
    addCall({ interaction_id: null });

    const result = await linkTelephonyCallToTicket({ callRecordId: 'call-1', ticketId: 'ticket-1' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Resolve this call/);
    expect(calls[0].ticket_id).toBeNull();
  });

  it('T044: linking honors the ticket update permission', async () => {
    addCall();
    hasPermissionMock.mockResolvedValue(false);

    const result = await linkTelephonyCallToTicket({ callRecordId: 'call-1', ticketId: 'ticket-1' });

    expect(result.success).toBe(false);
    expect(interactions[0].ticket_id).toBeNull();
    expect(calls[0].ticket_id).toBeNull();
  });

  it('T041: the picker only offers open tickets belonging to the matched client', async () => {
    addCall();

    const result = await listTelephonyLinkableTickets({ callRecordId: 'call-1' });

    expect(result.success).toBe(true);
    expect(result.tickets.map((ticket) => ticket.ticketId)).toEqual(['ticket-1']);
    expect(result.tickets[0]).toMatchObject({ ticketNumber: '1001', title: 'Printer down', statusName: 'Open' });
  });

  it('T041: the picker refuses a call with no client attribution', async () => {
    addCall({ matched_client_id: null });

    const result = await listTelephonyLinkableTickets({ callRecordId: 'call-1' });

    expect(result.success).toBe(false);
    expect(result.tickets).toEqual([]);
  });
});
