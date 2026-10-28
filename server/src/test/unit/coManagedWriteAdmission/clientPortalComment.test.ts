import { expect, it, vi } from 'vitest';
import {
  CO_MANAGED_TENANT,
  clearWriteAdmissionCacheForTests,
  createFakeKnex,
  withReadOnlyWorkspace,
} from './fakeKnex';

const VALID_ID = '00000000-0000-4000-8000-000000000001';

vi.mock('@alga-psa/client-portal/lib/portalTicketExternalLinks', () => ({ loadPortalTicketExternalLinks: vi.fn(async () => []) }));
vi.mock('@alga-psa/db/commentEventRegistry', () => ({ publishCommentEvent: vi.fn(async () => undefined) }));

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

// Real @alga-psa/db (tenantDb, withTransaction, the write choke point); only the connection is the recording fake.
vi.mock('@alga-psa/db', async (orig) => ({
  ...(await orig<object>()),
  getConnection: (...args: any[]) => getConnectionMock(...args),
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
}));


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


it('addClientTicketComment returns the mapped refusal payload from the REAL Comment.insert, with no write issued (A4)', async () => {
  clearWriteAdmissionCacheForTests();
  const fake = createFakeKnex((sql) => {
    if (/from "users"/.test(sql)) return [{ user_id: 'client-user-1', contact_id: 'contact-1', first_name: 'C', last_name: 'U', user_type: 'client' }];
    if (/from "tickets"/.test(sql)) return [{ ticket_id: VALID_ID, client_id: 'client-1', tenant: CO_MANAGED_TENANT }];
    return undefined;
  });
  currentUser = { user_id: 'client-user-1', user_type: 'client', email: 'c@example.com', tenant: CO_MANAGED_TENANT };
  hasPermissionMock.mockResolvedValue(true);
  getConnectionMock.mockResolvedValue(fake.knex);

  const actions = await import('@alga-psa/client-portal/actions/client-portal-actions/client-tickets');
  const result = await withReadOnlyWorkspace(() => actions.addClientTicketComment(VALID_ID, 'hello'));

  expect(result).toEqual({
    actionError: 'This co-managed workspace is read-only. Sign-in, reading, export, and license recovery remain available.',
    messageKey: 'common:errors.coManaged.readOnly',
  });
  expect(fake.writes()).toEqual([]);
  await fake.destroy();
});

it('the client portal comment action succeeds with the kill switch off', async () => {
  clearWriteAdmissionCacheForTests();
  vi.stubEnv('FORCE_CAPABILITIES', 'co-managed:off');
  const fake = createFakeKnex((sql) => {
    if (/from "users"/.test(sql)) return [{ user_id: 'client-user-1', contact_id: 'contact-1', first_name: 'C', last_name: 'U', user_type: 'client' }];
    if (/from "tickets"/.test(sql)) return [{ ticket_id: VALID_ID, client_id: 'client-1', tenant: CO_MANAGED_TENANT }];
    if (/gen_random_uuid\(\)/i.test(sql)) return [{ comment_id: VALID_ID, thread_id: VALID_ID }];
    if (/insert into "comments"|from "comments"/i.test(sql)) return [{ comment_id: VALID_ID, ticket_id: VALID_ID, note: 'hello', created_at: new Date().toISOString() }];
    return undefined;
  });
  currentUser = { user_id: 'client-user-1', user_type: 'client', email: 'c@example.com', tenant: CO_MANAGED_TENANT };
  hasPermissionMock.mockResolvedValue(true);
  getConnectionMock.mockResolvedValue(fake.knex);
  try {
    const actions = await import('@alga-psa/client-portal/actions/client-portal-actions/client-tickets');
    await expect(withReadOnlyWorkspace(() => actions.addClientTicketComment(VALID_ID, 'hello'))).resolves.toBe(true);
    expect(fake.writes().some((sql) => /insert into "comments"/i.test(sql))).toBe(true);
    expect(fake.statements.some((sql) => /^commit/i.test(sql))).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    await fake.destroy();
  }
});
