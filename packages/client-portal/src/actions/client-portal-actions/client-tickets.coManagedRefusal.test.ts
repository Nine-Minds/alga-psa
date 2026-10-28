import { expect, it, vi } from 'vitest';

const VALID_ID = '00000000-0000-4000-8000-000000000001';

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

const commentInsertMock = vi.fn();
vi.mock('@alga-psa/tickets/models/comment', () => ({ default: { insert: (...a: any[]) => commentInsertMock(...a) } }));
vi.mock('@alga-psa/formatting/blocknoteUtils', () => ({ convertBlockNoteToMarkdown: vi.fn(async () => 'md') }));

vi.mock('@alga-psa/tickets/lib', () => ({
  applyTicketVisibilityFilter: (query: any) => query,
  getClientContactVisibilityContext: vi.fn(),
  getTicketOrigin: () => 'internal',
  parseTicketStatusFilterValue: () => ({ kind: 'open' }),
}));

vi.mock('@alga-psa/tickets/lib/clientPortalVisibility.server', () => ({
  getClientContactVisibilityContext: vi.fn(async () => ({ clientId: 'client-1' })),
}));

vi.mock('@shared/models/ticketModel', () => ({
  TicketModel: { createTicketWithRetry: vi.fn(), getDefaultStatusId: vi.fn() },
}));

vi.mock('@alga-psa/event-bus', () => ({ ServerEventPublisher: class {} }));
vi.mock('@alga-psa/analytics', () => ({ ServerAnalyticsTracker: class {} }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(), publishWorkflowEvent: vi.fn(async () => undefined), publishNonCatalogWorkflowEvent: vi.fn(async () => undefined), publishStoredWorkflowEvent: vi.fn(async () => undefined), publishBuiltWorkflowPayload: vi.fn(async () => undefined), publishNonCatalogEventByName: vi.fn(async () => undefined), publishUnregisteredEventType: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/tickets/actions/ticketBundleUtils', () => ({
  maybeReopenBundleMasterFromChildReply: vi.fn(),
  revertBundlePropagationForChild: vi.fn(),
}));
vi.mock('@alga-psa/tickets/lib/liveUpdates', () => ({ publishTicketUpdate: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@alga-psa/user-composition/actions', () => ({
  getUserAvatarUrlAction: vi.fn().mockResolvedValue(null),
  getContactAvatarUrlAction: vi.fn().mockResolvedValue(null),
}));


// A chainable, awaitable query stub: every builder method returns itself; `first` resolves a row.
function chain(row: unknown) {
  const q: any = new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'first' ? async () => row : prop === 'then' ? undefined : () => q),
  });
  return q;
}

it('addClientTicketComment returns the mapped refusal payload when write admission refuses (A4)', async () => {
  const { createCoManagedWriteAdmissionResolver } = await import('@alga-psa/licensing/co-managed-write-admission');
  const decision = await createCoManagedWriteAdmissionResolver(async () => ({ state: 'read_only', canWrite: false, graceEndsAt: null }))({} as any, 'tenant-1');
  commentInsertMock.mockRejectedValue(decision.denial);
  currentUser = { user_id: 'client-user-1', user_type: 'client', email: 'c@example.com', tenant: 'tenant-1' };
  hasPermissionMock.mockResolvedValue(true);
  getConnectionMock.mockResolvedValue(Object.assign(vi.fn(), { raw: vi.fn() }));
  withTransactionMock.mockImplementation(async (_db: any, work: any) =>
    work(Object.assign((table: string) => chain(table === 'users' ? { contact_id: 'contact-1' } : { ticket_id: VALID_ID }), { raw: vi.fn() })),
  );

  const actions = await import('./client-tickets');
  const result = await actions.addClientTicketComment(VALID_ID, 'hello');

  expect(result).toEqual({
    actionError: 'This co-managed workspace is read-only. Sign-in, reading, export, and license recovery remain available.',
    messageKey: 'common:errors.coManaged.readOnly',
  });
});
