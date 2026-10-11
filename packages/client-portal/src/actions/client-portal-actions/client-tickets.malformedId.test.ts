import { beforeEach, describe, expect, it, vi } from 'vitest';

const VALID_ID = '00000000-0000-4000-8000-000000000001';
const BAD_IDS = ['T0001', 'not-a-uuid', '', "x' or '1'='1"];
const NOT_FOUND = {
  actionError: 'Ticket not found or access denied',
  messageKey: 'client-portal:errors.tickets.notFoundOrDenied',
};

vi.mock('../../lib/portalTicketExternalLinks', () => ({ loadPortalTicketExternalLinks: vi.fn(async () => []) }));

let currentUser: any;

const hasPermissionMock = vi.fn();
const getConnectionMock = vi.fn();
const withTransactionMock = vi.fn();
const createTenantKnexMock = vi.fn();

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
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  tenantDb: (conn: any) => ({ table: (table: string) => conn(table), unscoped: (table: string) => conn(table) }),
}));

vi.mock('@alga-psa/tickets/lib', () => ({
  applyTicketVisibilityFilter: (query: any) => query,
  getClientContactVisibilityContext: vi.fn(),
  getTicketOrigin: () => 'internal',
  parseTicketStatusFilterValue: () => ({ kind: 'open' }),
}));

vi.mock('@alga-psa/tickets/lib/clientPortalVisibility.server', () => ({
  getClientContactVisibilityContext: vi.fn(),
}));

vi.mock('@shared/models/ticketModel', () => ({
  TicketModel: { createTicketWithRetry: vi.fn(), getDefaultStatusId: vi.fn() },
}));

vi.mock('@alga-psa/event-bus', () => ({ ServerEventPublisher: class {} }));
vi.mock('@alga-psa/analytics', () => ({ ServerAnalyticsTracker: class {} }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn() }));
vi.mock('@alga-psa/tickets/actions/ticketBundleUtils', () => ({
  maybeReopenBundleMasterFromChildReply: vi.fn(),
  revertBundlePropagationForChild: vi.fn(),
}));
vi.mock('@alga-psa/tickets/lib/liveUpdates', () => ({ publishTicketUpdate: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@alga-psa/user-composition/actions', () => ({
  getUserAvatarUrlAction: vi.fn().mockResolvedValue(null),
  getContactAvatarUrlAction: vi.fn().mockResolvedValue(null),
}));

type Call = {
  name: string;
  run: (actions: typeof import('./client-tickets'), ticketId: string) => Promise<unknown>;
  permissionMessage: string;
};

const CALLS: Call[] = [
  {
    name: 'getClientTicketDetails',
    run: (a, id) => a.getClientTicketDetails(id),
    permissionMessage: 'Insufficient permissions to view ticket details',
  },
  {
    name: 'getClientTicketDocuments',
    run: (a, id) => a.getClientTicketDocuments(id),
    permissionMessage: 'Insufficient permissions to view ticket documents',
  },
  {
    name: 'addClientTicketComment',
    run: (a, id) => a.addClientTicketComment(id, 'hello'),
    permissionMessage: 'Insufficient permissions to add comments',
  },
  {
    name: 'updateTicketStatus',
    run: (a, id) => a.updateTicketStatus(id, 'status-2'),
    permissionMessage: 'Insufficient permissions to update ticket status',
  },
];

describe('client portal ticket actions: malformed ticket ids', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = {
      user_id: 'client-user-1',
      user_type: 'client',
      email: 'client@example.com',
      tenant: 'tenant-1',
    };
    hasPermissionMock.mockResolvedValue(true);
    getConnectionMock.mockResolvedValue(Object.assign(vi.fn(), { raw: vi.fn() }));
    createTenantKnexMock.mockResolvedValue({ knex: {} as any });
  });

  describe.each(CALLS)('$name', (call) => {
    it.each(BAD_IDS)('returns the ordinary not-found error for %j without touching the database', async (badId) => {
      const actions = await import('./client-tickets');

      await expect(call.run(actions, badId)).resolves.toEqual(NOT_FOUND);
      expect(withTransactionMock).not.toHaveBeenCalled();
    });

    it.each(BAD_IDS)('still reports the permission error for %j when the user lacks permission', async (badId) => {
      hasPermissionMock.mockResolvedValue(false);
      const actions = await import('./client-tickets');

      const result = await call.run(actions, badId);

      expect(result).toMatchObject({ permissionError: call.permissionMessage });
      expect(result).not.toMatchObject(NOT_FOUND);
      expect(withTransactionMock).not.toHaveBeenCalled();
    });
  });

  it.each(BAD_IDS)('addClientTicketComment returns not-found for a malformed parentCommentId %j', async (badParent) => {
    const actions = await import('./client-tickets');

    await expect(actions.addClientTicketComment(VALID_ID, 'reply', false, false, badParent)).resolves.toEqual(NOT_FOUND);
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it('lets a well-formed id through to the database layer', async () => {
    withTransactionMock.mockRejectedValue(new Error('reached withTransaction'));
    const actions = await import('./client-tickets');

    await expect(actions.getClientTicketDetails(VALID_ID)).rejects.toThrow('reached withTransaction');
    expect(withTransactionMock).toHaveBeenCalledTimes(1);
  });
});
