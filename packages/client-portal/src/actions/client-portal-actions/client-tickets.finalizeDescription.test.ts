import { beforeEach, describe, expect, it, vi } from 'vitest';

const TICKET_ID = '00000000-0000-4000-8000-000000000001';
const NOT_FOUND = {
  actionError: 'Ticket not found or access denied',
  messageKey: 'client-portal:errors.tickets.notFoundOrDenied',
};
const DESCRIPTION = JSON.stringify([
  { type: 'image', props: { url: '/api/documents/view/file-1' } },
]);

vi.mock('../../lib/portalTicketExternalLinks', () => ({ loadPortalTicketExternalLinks: vi.fn(async () => []) }));

let currentUser: any;

const hasPermissionMock = vi.fn();
const getConnectionMock = vi.fn();
const withTransactionMock = vi.fn();
const createTenantKnexMock = vi.fn();
const canWriteAttachmentTicketMock = vi.fn();
const updateMock = vi.fn();

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

// The upload gate the staged images already passed is the same gate this action
// reuses, so it is the seam the tests drive.
vi.mock('@shared/lib/ticketCommentAttachments', () => ({
  canWriteAttachmentTicket: (...args: any[]) => canWriteAttachmentTicketMock(...args),
  reconcileCommentAttachments: vi.fn(),
  filterReadableCommentAttachments: vi.fn(async (_trx: any, _tenant: string, _userId: string, rows: any[]) => rows),
  withdrawCommentAttachments: vi.fn(),
  persistCommentPublication: vi.fn(),
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
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/tickets/actions/ticketBundleUtils', () => ({
  maybeReopenBundleMasterFromChildReply: vi.fn(),
  revertBundlePropagationForChild: vi.fn(),
}));
vi.mock('@alga-psa/tickets/lib/liveUpdates', () => ({ publishTicketUpdate: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@alga-psa/user-composition/actions/avatarActions', () => ({
  getUserAvatarUrlAction: vi.fn().mockResolvedValue(null),
  getContactAvatarUrlAction: vi.fn().mockResolvedValue(null),
}));

/** tickets chain: .where({...}).first(...) for the load, .where({...}).update({...}) for the write. */
function makeTicketsTable(ticket: Record<string, unknown> | undefined) {
  const builder: any = {
    where: vi.fn(() => builder),
    first: vi.fn(async () => ticket),
    update: vi.fn(async (payload: Record<string, unknown>) => {
      updateMock(payload);
      return 1;
    }),
  };
  return builder;
}

function installTicket(ticket: Record<string, unknown> | undefined) {
  withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
    const trx = Object.assign(
      (table: string) => {
        if (table === 'tickets') return makeTicketsTable(ticket);
        throw new Error(`Unexpected table: ${table}`);
      },
      { raw: vi.fn() }
    );
    return callback(trx);
  });
}

describe('finalizeClientTicketDescription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = {
      user_id: 'client-user-1',
      user_type: 'client',
      email: 'client@example.com',
      tenant: 'tenant-1',
    };
    hasPermissionMock.mockResolvedValue(true);
    canWriteAttachmentTicketMock.mockResolvedValue(true);
    getConnectionMock.mockResolvedValue(Object.assign(vi.fn(), { raw: vi.fn() }));
    createTenantKnexMock.mockResolvedValue({ knex: {} as any });
    installTicket({
      ticket_id: TICKET_ID,
      entered_by: 'client-user-1',
      attributes: { description: '[]', watch_list: [{ contact_id: 'contact-9' }] },
    });
  });

  it('writes the finalized description into attributes for the ticket the user filed', async () => {
    const { finalizeClientTicketDescription } = await import('./client-tickets');

    await expect(finalizeClientTicketDescription(TICKET_ID, DESCRIPTION)).resolves.toBeUndefined();

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][0].attributes).toEqual({
      description: DESCRIPTION,
      // The rest of the attributes document is carried over, not rewritten.
      watch_list: [{ contact_id: 'contact-9' }],
    });
  });

  it('touches no ticket field other than the attributes document and its audit stamp', async () => {
    const { finalizeClientTicketDescription } = await import('./client-tickets');

    await finalizeClientTicketDescription(TICKET_ID, DESCRIPTION);

    expect(Object.keys(updateMock.mock.calls[0][0]).sort()).toEqual([
      'attributes',
      'updated_at',
      'updated_by',
    ]);
    expect(updateMock.mock.calls[0][0].updated_by).toBe('client-user-1');
  });

  it('refuses a ticket the attachment write gate rejects (another client)', async () => {
    canWriteAttachmentTicketMock.mockResolvedValue(false);
    const { finalizeClientTicketDescription } = await import('./client-tickets');

    await expect(finalizeClientTicketDescription(TICKET_ID, DESCRIPTION)).resolves.toEqual(NOT_FOUND);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("refuses a visible ticket another contact filed", async () => {
    installTicket({ ticket_id: TICKET_ID, entered_by: 'client-user-2', attributes: {} });
    const { finalizeClientTicketDescription } = await import('./client-tickets');

    await expect(finalizeClientTicketDescription(TICKET_ID, DESCRIPTION)).resolves.toEqual(NOT_FOUND);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('refuses a user without ticket update permission before any database work', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const { finalizeClientTicketDescription } = await import('./client-tickets');

    await expect(finalizeClientTicketDescription(TICKET_ID, DESCRIPTION)).resolves.toMatchObject({
      permissionError: 'Insufficient permissions to update tickets',
    });
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it('refuses an MSP user outright', async () => {
    currentUser = { ...currentUser, user_type: 'internal' };
    const { finalizeClientTicketDescription } = await import('./client-tickets');

    await expect(finalizeClientTicketDescription(TICKET_ID, DESCRIPTION)).resolves.toMatchObject({
      permissionError: 'Access denied: Client portal actions are restricted to client users',
    });
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it('refuses a malformed ticket id and an empty description without touching the database', async () => {
    const { finalizeClientTicketDescription } = await import('./client-tickets');

    await expect(finalizeClientTicketDescription('T0001', DESCRIPTION)).resolves.toEqual(NOT_FOUND);
    await expect(finalizeClientTicketDescription(TICKET_ID, '')).resolves.toMatchObject({
      actionError: expect.any(String),
    });
    expect(withTransactionMock).not.toHaveBeenCalled();
  });
});
