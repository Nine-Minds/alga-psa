import { beforeEach, describe, expect, it, vi } from 'vitest';
// Load during collection (see clientActions.importCsv.test.ts); vi.mock is hoisted.
import { markClientActiveWithContacts } from './clientActions';

const registerAfterCommitMock = vi.hoisted(() => vi.fn());
const publishWorkflowEventMock = vi.hoisted(() => vi.fn(async () => undefined));
const trackContactUpdatesMock = vi.hoisted(() =>
  vi.fn(async (_trx: unknown, _tenant: string, _ids: string[], _keys: string[], run: () => Promise<unknown>) => run()));
const withTransactionMock = vi.hoisted(() => vi.fn());
const hasPermissionAsyncMock = vi.hoisted(() => vi.fn());

type ServerAction = (...args: unknown[]) => unknown;

vi.mock('@alga-psa/auth', () => ({
  preCheckDeletion: vi.fn(),
  withAuth: (fn: ServerAction) => (...args: unknown[]) =>
    fn({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
  withOptionalAuth: (fn: ServerAction) => (...args: unknown[]) =>
    fn({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/core', () => ({
  deleteEntityWithValidation: vi.fn(),
  unparseCSV: vi.fn(),
  isEnterprise: false,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  tenantDb: (conn: any) => ({ table: (table: string) => conn(table) }),
  withTransaction: withTransactionMock,
  registerAfterCommit: registerAfterCommitMock,
}));

vi.mock('@alga-psa/shared/lib/contacts/contactEvents', () => ({
  trackContactUpdates: trackContactUpdatesMock,
}));

vi.mock('../lib/authHelpers', () => ({
  hasPermissionAsync: hasPermissionAsyncMock,
  isClientPortalUser: () => false,
  hasMspPermission: async (user: any, resource: string, action: string) =>
    user?.user_type === 'internal' && (await hasPermissionAsyncMock(user, resource, action)),
  assertMspPermission: vi.fn(),
  hasMspOrClientPortalOwnClientPermission: vi.fn(),
  assertMspOrClientPortalOwnClientPermission: vi.fn(),
}));

vi.mock('../lib/billingHelpers', () => ({ createDefaultTaxSettingsAsync: vi.fn() }));
vi.mock('../lib/documentsHelpers', () => ({
  getClientLogoUrlAsync: vi.fn(),
  getClientWideLogoUrlAsync: vi.fn(),
  getClientLogoUrlsBatchAsync: vi.fn(),
}));
vi.mock('@alga-psa/storage', () => ({
  uploadEntityImage: vi.fn(),
  deleteEntityImage: vi.fn(),
  recropEntityLogo: vi.fn(),
  parseLogoCrop: vi.fn(() => null),
}));
vi.mock('@alga-psa/tags/actions/tagActions', () => ({ createTag: vi.fn(), findTagsByEntityId: vi.fn() }));
vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({ deleteEntityTags: vi.fn() }));
vi.mock('@alga-psa/shared/models/clientModel', () => ({ ClientModel: {} }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: publishWorkflowEventMock,
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
// The real buildClientUpdatedPayload is used on purpose: the test proves what it emits for is_inactive.
vi.mock('@alga-psa/shared/billingClients/defaultContract', () => ({
  ensureDefaultContractForClientIfBillingConfigured: vi.fn(),
}));
vi.mock('@alga-psa/shared/billingClients/billingProfiles', () => ({
  ensureClientDefaultBillingProfile: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

interface Fake {
  clientRow: { is_inactive: boolean } | undefined;
  inactiveContacts: Array<{ contact_name_id: string }>;
  writes: Array<{ table: string; data: Record<string, unknown> }>;
}
let fake: Fake;

function table(name: string): any {
  const chain: any = {
    select: () => chain,
    where: () => chain,
    whereIn: () => chain,
    andWhere: () => chain,
    first: async () => (name === 'clients' ? fake.clientRow : undefined),
    update: async (data: Record<string, unknown>) => {
      fake.writes.push({ table: name, data });
      return 1;
    },
    then: (resolve: (v: unknown) => unknown) =>
      resolve(name === 'contacts' ? fake.inactiveContacts : []),
  };
  return chain;
}

const clientUpdatedCalls = () =>
  registerAfterCommitMock.mock.calls.filter((c) => String(c[2]).startsWith('CLIENT_UPDATED'));

describe('markClientActiveWithContacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermissionAsyncMock.mockResolvedValue(true);
    fake = { clientRow: { is_inactive: true }, inactiveContacts: [], writes: [] };
    withTransactionMock.mockImplementation(async (_db: unknown, cb: (trx: any) => Promise<unknown>) => cb(table));
  });

  it('queues CLIENT_UPDATED[is_inactive] after commit on an inactive -> active flip', async () => {
    const result = await markClientActiveWithContacts('client-1', false);
    expect(result.success).toBe(true);

    const calls = clientUpdatedCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toBe('CLIENT_UPDATED client=client-1');
    expect(publishWorkflowEventMock).not.toHaveBeenCalled(); // deferred until commit

    await calls[0][1]();
    expect(publishWorkflowEventMock).toHaveBeenCalledTimes(1);
    const arg = (publishWorkflowEventMock.mock.calls as any[][])[0][0];
    expect(arg.eventType).toBe('CLIENT_UPDATED');
    expect(arg.payload.clientId).toBe('client-1');
    expect(arg.payload.updatedFields).toEqual(['isInactive']);
    expect(arg.ctx.tenantId).toBe('tenant-1');
    expect(arg.ctx.actor).toEqual({ actorType: 'USER', actorUserId: 'user-1' });
    const occurredAt = arg.ctx.occurredAt;
    expect(arg.idempotencyKey).toBe(`client_updated:client-1:${occurredAt}`);
    expect(arg.payload.updatedAt).toBe(occurredAt);
    const clientWrite = fake.writes.find((w) => w.table === 'clients')!;
    expect(clientWrite.data).toEqual({ is_inactive: false, updated_at: occurredAt });
  });

  it('queues no CLIENT_UPDATED when the client is already active', async () => {
    fake.clientRow = { is_inactive: false };
    const result = await markClientActiveWithContacts('client-1', false);
    expect(result.success).toBe(true);
    expect(clientUpdatedCalls()).toHaveLength(0);
  });

  it('queues no CLIENT_UPDATED when the client row does not exist', async () => {
    fake.clientRow = undefined;
    await markClientActiveWithContacts('client-1', false);
    expect(clientUpdatedCalls()).toHaveLength(0);
  });

  it('keeps the contact cascade unchanged when reactivateContacts=true', async () => {
    fake.inactiveContacts = [{ contact_name_id: 'c1' }, { contact_name_id: 'c2' }];
    const result = await markClientActiveWithContacts('client-1', true);

    expect(result).toEqual({ success: true, contactsReactivated: 2 });
    expect(trackContactUpdatesMock).toHaveBeenCalledTimes(1);
    expect(trackContactUpdatesMock.mock.calls[0].slice(1, 4)).toEqual(['tenant-1', ['c1', 'c2'], ['is_inactive']]);
    expect(fake.writes.filter((w) => w.table === 'contacts').map((w) => w.data)).toEqual([{ is_inactive: false }]);
    expect(fake.writes.filter((w) => w.table === 'users').map((w) => w.data)).toEqual([{ is_inactive: false }]);
    expect(clientUpdatedCalls()).toHaveLength(1);
  });

  it('does not touch contacts when reactivateContacts=false', async () => {
    fake.inactiveContacts = [{ contact_name_id: 'c1' }];
    const result = await markClientActiveWithContacts('client-1', false);
    expect(result.contactsReactivated).toBe(0);
    expect(trackContactUpdatesMock).not.toHaveBeenCalled();
  });
});
