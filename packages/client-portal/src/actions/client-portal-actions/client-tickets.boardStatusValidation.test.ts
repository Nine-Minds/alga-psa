import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;

const hasPermissionMock = vi.fn();
const getConnectionMock = vi.fn();
const withTransactionMock = vi.fn();
const publishEventMock = vi.fn();
const publishWorkflowEventMock = vi.fn();
const writeTicketActivityMock = vi.fn();
const enforceTicketCloseRulesMock = vi.fn();
const ticketModelGetDefaultStatusIdMock = vi.fn();
const ticketModelCreateTicketWithRetryMock = vi.fn();

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

vi.mock('@alga-psa/validation', () => ({
  validateData: (_schema: unknown, payload: Record<string, unknown>) => payload,
}));

vi.mock('@shared/models/ticketModel', () => ({
  TicketModel: {
    getDefaultStatusId: (...args: any[]) => ticketModelGetDefaultStatusIdMock(...args),
    createTicketWithRetry: (...args: any[]) => ticketModelCreateTicketWithRetryMock(...args),
  },
}));

vi.mock('@alga-psa/event-bus', () => ({
  ServerEventPublisher: class {},
}));

vi.mock('@alga-psa/analytics', () => ({
  ServerAnalyticsTracker: class {},
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: (...args: any[]) => publishEventMock(...args),
  publishWorkflowEvent: (...args: any[]) => publishWorkflowEventMock(...args),
}));

vi.mock('@shared/lib/ticketActivity', () => ({
  writeTicketActivity: (...args: any[]) => writeTicketActivityMock(...args),
  TICKET_ACTIVITY_ACTOR: { USER: 'user' },
  TICKET_ACTIVITY_ENTITY: { TICKET: 'ticket' },
  TICKET_ACTIVITY_EVENT: { CLOSED: 'closed', REOPENED: 'reopened', STATUS_CHANGED: 'status_changed' },
  TICKET_ACTIVITY_SOURCE: { CLIENT_PORTAL: 'client_portal' },
}));

vi.mock('@alga-psa/tickets/lib/validateTicketClosure', () => ({
  enforceTicketCloseRules: (...args: any[]) => enforceTicketCloseRulesMock(...args),
}));

vi.mock('@alga-psa/formatting/blocknoteUtils', () => ({
  convertBlockNoteToMarkdown: vi.fn(),
}));

vi.mock('@alga-psa/tickets/actions/ticketBundleUtils', () => ({
  maybeReopenBundleMasterFromChildReply: vi.fn(),
}));

vi.mock('@alga-psa/tickets/lib/liveUpdates', () => ({
  publishTicketUpdate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getUserAvatarUrlAction: vi.fn().mockResolvedValue(null),
  getContactAvatarUrlAction: vi.fn().mockResolvedValue(null),
}));

function createClientPortalTrx(overrides: {
  defaultBoard?: Record<string, unknown> | null;
  ticket?: Record<string, unknown> | null;
  statusForBoard?: Record<string, unknown> | null;
  oldStatus?: Record<string, unknown> | null;
  portalStatusRows?: Array<Record<string, unknown>>;
}) {
  const ticketUpdates: Array<Record<string, unknown>> = [];

  const trx = Object.assign(
    (table: string) => {
      if (table === 'users') {
        return {
          where: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue({ user_id: currentUser.user_id, contact_id: 'contact-1' }),
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

      if (table === 'boards') {
        return {
          where: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue(overrides.defaultBoard ?? null),
          }),
        };
      }

      if (table === 'tickets as t') {
        const builder: any = {
          select: vi.fn(() => builder),
          where: vi.fn(() => builder),
          modify: vi.fn((cb: (query: any) => void) => {
            cb(builder);
            return builder;
          }),
          first: vi.fn().mockResolvedValue(overrides.ticket ?? null),
        };
        return builder;
      }

      if (table === 'tickets') {
        let whereClause: Record<string, unknown> = {};
        return {
          where: vi.fn((value: Record<string, unknown>) => {
            whereClause = value;
            return {
              first: vi.fn().mockResolvedValue(overrides.ticket ?? null),
              update: vi.fn(async (updateData: Record<string, unknown>) => {
                ticketUpdates.push({ where: whereClause, updateData });
                return 1;
              }),
            };
          }),
        };
      }

      if (table === 'statuses') {
        let whereObj: Record<string, unknown> = {};
        let directSelectable: boolean | null = null;
        let callbackFilter: ((builder: any) => void) | null = null;

        const builder: any = {
          select: vi.fn(() => builder),
          orderBy: vi.fn(() => builder),
          where: vi.fn((arg1: any, arg2?: any) => {
            if (typeof arg1 === 'function') {
              callbackFilter = arg1;
            } else if (typeof arg1 === 'string') {
              if (arg1 === 'portal_selectable') {
                directSelectable = arg2;
              } else {
                whereObj = { ...whereObj, [arg1]: arg2 };
              }
            } else if (arg1 && typeof arg1 === 'object') {
              whereObj = { ...whereObj, ...arg1 };
            }
            return builder;
          }),
          first: vi.fn(async () => {
            if ('board_id' in whereObj) {
              return overrides.statusForBoard ?? null;
            }
            if ('status_id' in whereObj) {
              return overrides.oldStatus ?? overrides.statusForBoard ?? null;
            }
            return null;
          }),
          then: (resolve: any, reject: any) => {
            let rows = (overrides.portalStatusRows ?? []).filter((status) => {
              if ('board_id' in whereObj && status.board_id !== whereObj.board_id) return false;
              if (status.status_type !== undefined && status.status_type !== 'ticket') return false;
              return true;
            });

            if (directSelectable === true) {
              rows = rows.filter((status) => status.portal_selectable === true);
            }

            if (callbackFilter) {
              let requireSelectable = false;
              let currentStatusId: unknown;
              const inner: any = {
                where: vi.fn(() => {
                  requireSelectable = true;
                  return inner;
                }),
                orWhere: vi.fn((_column: string, value: unknown) => {
                  currentStatusId = value;
                  return inner;
                }),
              };
              callbackFilter(inner);
              rows = rows.filter(
                (status) =>
                  (requireSelectable && status.portal_selectable === true) ||
                  status.status_id === currentStatusId
              );
            }

            return Promise.resolve(rows).then(resolve, reject);
          },
        };

        return builder;
      }

      throw new Error(`Unexpected table: ${table}`);
    },
    {
      fn: { now: () => 'now()' },
      raw: vi.fn().mockResolvedValue({ rows: [] }),
    }
  ) as any;

  return { trx, ticketUpdates };
}

describe('client portal board-scoped ticket status validation', () => {
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
    ticketModelGetDefaultStatusIdMock.mockResolvedValue('board-1-default-status');
    ticketModelCreateTicketWithRetryMock.mockResolvedValue({ ticket_id: 'ticket-1' });
    publishEventMock.mockResolvedValue(undefined);
    publishWorkflowEventMock.mockResolvedValue(undefined);
    writeTicketActivityMock.mockResolvedValue(undefined);
    enforceTicketCloseRulesMock.mockResolvedValue({ overridden: false, bypassed: false });
  });

  it('T041: createClientTicket resolves the default status from the default board before ticket creation', async () => {
    const { trx } = createClientPortalTrx({
      defaultBoard: { board_id: 'board-1', default_assigned_to: null },
      ticket: { ticket_id: 'ticket-1', tenant: 'tenant-1' },
    });

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(trx));

    const { createClientTicket } = await import('./client-tickets');
    const formData = new FormData();
    formData.append('title', 'Portal issue');
    formData.append('description', 'Customer reported an outage');
    formData.append('priority_id', 'priority-1');

    await createClientTicket(formData);

    expect(ticketModelGetDefaultStatusIdMock).toHaveBeenCalledWith('tenant-1', trx, 'board-1');
    expect(ticketModelCreateTicketWithRetryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        board_id: 'board-1',
        status_id: 'board-1-default-status',
      }),
      'tenant-1',
      trx,
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      'client-user-1',
      3
    );
  });

  it('T042: updateTicketStatus rejects a status that does not belong to the ticket board', async () => {
    const { trx, ticketUpdates } = createClientPortalTrx({
      ticket: {
        ticket_id: 'ticket-1',
        tenant: 'tenant-1',
        board_id: 'board-1',
        status_id: 'board-1-open',
      },
      statusForBoard: null,
    });

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(trx));

    const { updateTicketStatus } = await import('./client-tickets');

    await expect(updateTicketStatus('ticket-1', 'board-2-closed')).resolves.toEqual({
      actionError: 'Selected status is not valid for the ticket board',
    });
    expect(ticketUpdates).toHaveLength(0);
    expect(publishEventMock).not.toHaveBeenCalled();
  });

  it('T001: updateTicketStatus accepts a default-selectable board status and updates the ticket', async () => {
    const { trx, ticketUpdates } = createClientPortalTrx({
      ticket: {
        ticket_id: 'ticket-1',
        tenant: 'tenant-1',
        board_id: 'board-1',
        status_id: 'board-1-open',
        response_state: null,
      },
      statusForBoard: {
        status_id: 'board-1-in-progress',
        is_closed: false,
        name: 'In progress',
        portal_selectable: true,
      },
      oldStatus: { status_id: 'board-1-open', is_closed: false },
    });

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(trx));

    const { updateTicketStatus } = await import('./client-tickets');

    await expect(updateTicketStatus('ticket-1', 'board-1-in-progress')).resolves.toBeUndefined();
    expect(ticketUpdates).toHaveLength(1);
    expect(ticketUpdates[0].updateData).toMatchObject({
      status_id: 'board-1-in-progress',
      is_closed: false,
    });
    expect(publishEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'TICKET_UPDATED' })
    );
  });

  it('T002/T003: updateTicketStatus rejects a non-selectable status with no mutation or closure event', async () => {
    const { trx, ticketUpdates } = createClientPortalTrx({
      ticket: {
        ticket_id: 'ticket-1',
        tenant: 'tenant-1',
        board_id: 'board-1',
        status_id: 'board-1-open',
        response_state: null,
      },
      statusForBoard: {
        status_id: 'board-1-vendor',
        is_closed: false,
        name: 'Waiting on Vendor',
        portal_selectable: false,
      },
      oldStatus: { status_id: 'board-1-open', is_closed: false },
    });

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(trx));

    const { updateTicketStatus } = await import('./client-tickets');

    await expect(updateTicketStatus('ticket-1', 'board-1-vendor')).resolves.toEqual(
      expect.objectContaining({
        actionError: 'This status cannot be selected from the client portal',
        messageKey: 'client-portal:errors.tickets.statusNotPortalSelectable',
      })
    );
    expect(ticketUpdates).toHaveLength(0);
    expect(publishEventMock).not.toHaveBeenCalled();
    expect(publishWorkflowEventMock).not.toHaveBeenCalled();
    expect(enforceTicketCloseRulesMock).not.toHaveBeenCalled();
  });

  it('T004: getClientPortalTicketStatuses omits non-selectable statuses for the board', async () => {
    const { trx } = createClientPortalTrx({
      portalStatusRows: [
        { status_id: 's-open', board_id: 'board-1', status_type: 'ticket', portal_selectable: true, order_number: 10, name: 'Open' },
        { status_id: 's-vendor', board_id: 'board-1', status_type: 'ticket', portal_selectable: false, order_number: 20, name: 'Waiting on Vendor' },
        { status_id: 's-other-board', board_id: 'board-2', status_type: 'ticket', portal_selectable: true, order_number: 30, name: 'Other' },
      ],
    });

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(trx));

    const { getClientPortalTicketStatuses } = await import('./client-tickets');

    const result = await getClientPortalTicketStatuses('board-1');
    expect(Array.isArray(result)).toBe(true);
    expect((result as Array<{ status_id: string }>).map((status) => status.status_id)).toEqual(['s-open']);
  });

  it('T005: getClientPortalTicketStatuses keeps the current non-selectable status visible', async () => {
    const { trx } = createClientPortalTrx({
      portalStatusRows: [
        { status_id: 's-open', board_id: 'board-1', status_type: 'ticket', portal_selectable: true, order_number: 10, name: 'Open' },
        { status_id: 's-vendor', board_id: 'board-1', status_type: 'ticket', portal_selectable: false, order_number: 20, name: 'Waiting on Vendor' },
      ],
    });

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(trx));

    const { getClientPortalTicketStatuses } = await import('./client-tickets');

    const result = await getClientPortalTicketStatuses('board-1', 's-vendor');
    expect((result as Array<{ status_id: string }>).map((status) => status.status_id).sort()).toEqual([
      's-open',
      's-vendor',
    ]);
  });

  it('T006: a non-selectable closed status cannot close, a selectable one still closes with the bypass', async () => {
    const { trx: restrictedTrx, ticketUpdates: restrictedUpdates } = createClientPortalTrx({
      ticket: {
        ticket_id: 'ticket-1',
        tenant: 'tenant-1',
        board_id: 'board-1',
        status_id: 'board-1-open',
        response_state: 'awaiting_client',
      },
      statusForBoard: {
        status_id: 'board-1-resolved',
        is_closed: true,
        name: 'Resolved',
        portal_selectable: false,
      },
      oldStatus: { status_id: 'board-1-open', is_closed: false },
    });

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(restrictedTrx));

    const { updateTicketStatus } = await import('./client-tickets');

    await expect(updateTicketStatus('ticket-1', 'board-1-resolved')).resolves.toEqual(
      expect.objectContaining({ messageKey: 'client-portal:errors.tickets.statusNotPortalSelectable' })
    );
    expect(restrictedUpdates).toHaveLength(0);
    expect(publishWorkflowEventMock).not.toHaveBeenCalled();
    expect(enforceTicketCloseRulesMock).not.toHaveBeenCalled();

    const { trx: allowedTrx, ticketUpdates: allowedUpdates } = createClientPortalTrx({
      ticket: {
        ticket_id: 'ticket-1',
        tenant: 'tenant-1',
        board_id: 'board-1',
        status_id: 'board-1-open',
        response_state: 'awaiting_client',
      },
      statusForBoard: {
        status_id: 'board-1-closed',
        is_closed: true,
        name: 'Closed',
        portal_selectable: true,
      },
      oldStatus: { status_id: 'board-1-open', is_closed: false },
    });

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(allowedTrx));

    await expect(updateTicketStatus('ticket-1', 'board-1-closed')).resolves.toBeUndefined();
    expect(enforceTicketCloseRulesMock).toHaveBeenCalledWith(
      allowedTrx,
      'tenant-1',
      expect.objectContaining({ bypass: { source: 'client_portal' } })
    );
    expect(allowedUpdates).toHaveLength(1);
    expect(allowedUpdates[0].updateData).toMatchObject({
      status_id: 'board-1-closed',
      is_closed: true,
      response_state: null,
      closed_by: 'client-user-1',
    });
    expect(allowedUpdates[0].updateData).toEqual(
      expect.objectContaining({ closed_at: expect.any(String) })
    );
    expect(publishWorkflowEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'TICKET_CLOSED' })
    );
  });
});
