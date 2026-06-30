import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TICKET_ORIGINS } from '@alga-psa/types';

let currentUser: any;

const hasPermissionMock = vi.fn();
const getConnectionMock = vi.fn();
const withTransactionMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
  withOptionalAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: (...args: any[]) => getConnectionMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  createTenantKnex: vi.fn(),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (table: string) => conn(table),
    unscoped: (table: string) => conn(table),
    tenantJoin: (query: any, _table?: string, _left?: string, _right?: string, options: any = {}) => {
      const join = options?.type === 'left' ? query.leftJoin : query.join;
      return typeof join === 'function' ? join.call(query) : query;
    },
  }),
}));

vi.mock('@alga-psa/documents/lib/blocknoteUtils', () => ({
  convertBlockNoteToMarkdown: vi.fn(),
}));

vi.mock('@shared/models/ticketModel', () => ({
  TicketModel: {},
}));

vi.mock('@alga-psa/event-bus', () => ({
  ServerEventPublisher: class {},
}));

vi.mock('@alga-psa/analytics', () => ({
  ServerAnalyticsTracker: class {},
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
}));

vi.mock('@alga-psa/tickets/actions/ticketBundleUtils', () => ({
  maybeReopenBundleMasterFromChildReply: vi.fn(),
}));

vi.mock('@alga-psa/tickets/lib/liveUpdates', () => ({
  publishTicketUpdate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@alga-psa/users/actions', () => ({
  getUserAvatarUrlAction: vi.fn().mockResolvedValue(null),
  getContactAvatarUrlAction: vi.fn().mockResolvedValue(null),
}));

function makeTicket(overrides: Record<string, unknown> = {}) {
  return {
    ticket_id: 'ticket-1',
    ticket_number: 'T-2001',
    title: 'Portal Ticket',
    board_id: 'board-1',
    client_id: 'client-1',
    status_id: 'status-1',
    entered_by: 'creator-1',
    assigned_to: null,
    entered_at: '2026-02-09T00:00:00.000Z',
    updated_at: '2026-02-09T00:00:00.000Z',
    closed_at: null,
    source: null,
    email_metadata: null,
    status_name: 'Open',
    priority_name: 'Medium',
    priority_color: '#FFAA00',
    entered_by_user_type: 'internal',
    ...overrides,
  };
}

// Generic chain-/thenable query-builder stand-in. Every builder method returns the
// same builder (so the SUT can chain arbitrarily), `modify` invokes its callback, and
// awaiting the builder resolves to `result`. Used for the ticket_resources/comments/
// users subqueries the refactored SUT builds via tenantDb(trx, tenant).table(...) and
// then awaits directly inside Promise.all.
function makeChainable(result: any = []) {
  const builder: any = {};
  for (const method of [
    'select', 'distinct', 'where', 'whereRaw', 'whereNotNull', 'whereIn',
    'orWhereIn', 'join', 'leftJoin', 'innerJoin', 'orderBy', 'as', 'first',
  ]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.modify = vi.fn((callback: (query: any) => void) => {
    if (typeof callback === 'function') callback(builder);
    return builder;
  });
  builder.then = (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function buildTrx(params: { ticket: Record<string, unknown> | undefined }) {
  return Object.assign(
    (table: string) => {
      if (table === 'users') {
        return {
          where: vi.fn().mockReturnValue({
            first: vi
              .fn()
              .mockResolvedValue({ user_id: currentUser.user_id, contact_id: 'contact-1' }),
          }),
        };
      }

      if (table === 'contacts') {
        return {
          where: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue({ contact_name_id: 'contact-1', client_id: 'client-1' }),
          }),
        };
      }

      if (table === 'tickets as t') {
        // The SUT builds the ticket query then awaits the builder itself inside
        // Promise.all (it no longer captures `.first()`), so the builder must be
        // thenable and resolve to the ticket.
        const builder = makeChainable();
        builder.then = (resolve: any, reject?: any) =>
          Promise.resolve(params.ticket).then(resolve, reject);
        return builder;
      }

      if (table === 'comments') {
        return {
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        };
      }

      // Additional-agent / comment / assigned / involved-users subqueries plus the
      // client-visible documents and linked-assets queries, all awaited directly.
      if (
        table === 'ticket_resources as tr' ||
        table === 'ticket_resources as tr2' ||
        table === 'comments as c' ||
        table === 'tickets as assigned_ticket' ||
        table === 'users as u' ||
        table === 'documents as d' ||
        table === 'asset_associations as aa'
      ) {
        return makeChainable();
      }

      throw new Error(`Unexpected table: ${table}`);
    },
    {
      raw: vi.fn().mockResolvedValue({ rows: [] }),
    }
  ) as any;
}

describe('getClientTicketDetails ticket origin derivation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = {
      user_id: 'client-user-1',
      user_type: 'client',
      email: 'client@example.com',
      tenant: 'tenant-1',
    };
    const dbConnection = Object.assign(vi.fn(), {
      raw: vi.fn(),
    });
    getConnectionMock.mockResolvedValue(dbConnection);
    hasPermissionMock.mockResolvedValue(true);
  });

  it('T034: response includes normalized ticket_origin for internal ticket', async () => {
    withTransactionMock.mockImplementation(
      async (_db: any, callback: (trx: any) => Promise<any>) =>
        callback(buildTrx({ ticket: makeTicket({ source: 'web_app' }) }))
    );

    const { getClientTicketDetails } = await import('./client-tickets');
    const ticket = await getClientTicketDetails('ticket-1');

    expect(ticket.ticket_origin).toBe(TICKET_ORIGINS.INTERNAL);
  });

  it('T036: response includes normalized ticket_origin for inbound_email ticket', async () => {
    withTransactionMock.mockImplementation(
      async (_db: any, callback: (trx: any) => Promise<any>) =>
        callback(
          buildTrx({
            ticket: makeTicket({
              email_metadata: { messageId: 'm-1' },
              source: 'client_portal',
            }),
          })
        )
    );

    const { getClientTicketDetails } = await import('./client-tickets');
    const ticket = await getClientTicketDetails('ticket-1');

    expect(ticket.ticket_origin).toBe(TICKET_ORIGINS.INBOUND_EMAIL);
  });

  it('T035: response includes normalized ticket_origin for client_portal ticket', async () => {
    withTransactionMock.mockImplementation(
      async (_db: any, callback: (trx: any) => Promise<any>) =>
        callback(
          buildTrx({
            ticket: makeTicket({
              source: null,
              entered_by_user_type: 'client',
            }),
          })
        )
    );

    const { getClientTicketDetails } = await import('./client-tickets');
    const ticket = await getClientTicketDetails('ticket-1');

    expect(ticket.ticket_origin).toBe(TICKET_ORIGINS.CLIENT_PORTAL);
  });

  it('T037: response includes normalized ticket_origin for api ticket', async () => {
    withTransactionMock.mockImplementation(
      async (_db: any, callback: (trx: any) => Promise<any>) =>
        callback(
          buildTrx({
            ticket: makeTicket({
              source: 'client_portal',
              ticket_origin: 'api',
            }),
          })
        )
    );

    const { getClientTicketDetails } = await import('./client-tickets');
    const ticket = await getClientTicketDetails('ticket-1');

    expect(ticket.ticket_origin).toBe(TICKET_ORIGINS.API);
  });
});
