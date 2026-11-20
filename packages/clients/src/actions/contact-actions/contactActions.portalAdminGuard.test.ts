import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `contacts.is_client_admin` is the invitation pre-seed while the contact has no
 * portal user, and a mirror of the client portal 'Admin' role once it does
 * (alga-2026-0003347). updateContactPortalAdminStatus writes the flag directly,
 * so it must refuse the second case: the UI already hides the toggle there
 * (ContactPortalTab), but the action accepted any contact, and the value it
 * wrote would disagree with the user's roles until their next role change —
 * long enough for the portal visibility resolver to widen that user's ticket,
 * asset and project scope to the whole client.
 */
vi.mock('@alga-psa/authorization/recordCreateAuthorization', () => ({
  assertRecordCreateAllowed: vi.fn(async () => undefined),
}));

const createTenantKnexMock = vi.fn(async () => ({ knex: {} as any }));
const withTransactionMock = vi.fn();
const assertMspPermissionMock = vi.fn();
const assertContactIsNotSharedMailboxMock = vi.fn(async () => undefined);

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: () => createTenantKnexMock(),
  tenantDb: (conn: any) => ({
    table: (table: string) => conn(table),
  }),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
  withOptionalAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
  // The action reports through the string channel, which localizes the keyed
  // error first; the keys resolve against the real en locale files here, so the
  // assertions below are the message the caller actually sees.
  localizeActionError: async (result: any) => result,
}));

vi.mock('../../lib/authHelpers', () => ({
  assertMspPermission: (...args: any[]) => assertMspPermissionMock(...args),
  hasMspPermission: vi.fn(async () => true),
  isClientPortalUser: vi.fn(() => false),
  isMspUser: vi.fn(() => true),
  assertMspOrClientPortalOwnClientPermission: vi.fn(),
}));

vi.mock('@alga-psa/shared/models/contactModel', () => ({
  ContactModel: {
    createContact: vi.fn(),
    getContactById: vi.fn(),
    updateContact: vi.fn(),
  },
  assertContactIsNotSharedMailbox: (...args: any[]) => assertContactIsNotSharedMailboxMock(...(args as [])),
  deleteContactCascade: vi.fn(),
}));

vi.mock('../../lib/contactEvents', () => ({
  queueContactCreated: vi.fn(),
  queueContactUpdated: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  actionError: (message: string) => ({ actionError: message }),
  permissionError: (message: string) => ({ permissionError: message }),
}));

vi.mock('@alga-psa/core', () => ({
  isEnterprise: false,
  unparseCSV: vi.fn(),
}));

vi.mock('@alga-psa/core/server', () => ({
  deleteEntityWithValidation: vi.fn(),
}));

vi.mock('../../lib/documentsHelpers', () => ({
  getContactAvatarUrlsBatchAsync: vi.fn(async () => new Map()),
}));

vi.mock('@alga-psa/tags/actions', () => ({ createTag: vi.fn() }));
vi.mock('@alga-psa/tags/actions/tagActions', () => ({ createTagsForEntityWithTransaction: vi.fn() }));
vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({ deleteEntityTags: vi.fn() }));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/workflow-streams', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  buildContactArchivedPayload: vi.fn(),
  buildContactCreatedPayload: vi.fn(),
  buildContactUpdatedPayload: vi.fn(() => ({ updatedFields: [] })),
}));

import { updateContactPortalAdminStatus } from './contactActions';

const PORTAL_ADMIN_REFUSAL =
  "This contact has a portal user, so portal admin is controlled by that user's role.";

/** contacts.first() for the permission resolve, users.first() for the guard, contacts.update() for the write. */
function buildTrx({ portalUser, updated = 1 }: { portalUser?: { user_id: string }; updated?: number }) {
  const contactUpdate = vi.fn(async (_values: Record<string, unknown>) => updated);
  const userWhere = vi.fn(() => ({ first: async () => portalUser }));

  const trx: any = (table: string) => {
    if (table === 'contacts') {
      return {
        where: () => ({
          first: async () => ({ contact_name_id: 'contact-1', client_id: 'client-1' }),
          update: contactUpdate,
        }),
      };
    }
    if (table === 'users') return { where: userWhere };
    throw new Error(`Unexpected table ${table}`);
  };
  trx.isTransaction = true;
  return { trx, contactUpdate, userWhere };
}

describe('updateContactPortalAdminStatus portal-user guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertMspPermissionMock.mockResolvedValue(undefined);
    assertContactIsNotSharedMailboxMock.mockResolvedValue(undefined as never);
  });

  it('refuses a contact that already has a portal user, and writes nothing', async () => {
    const { trx, contactUpdate, userWhere } = buildTrx({ portalUser: { user_id: 'user-9' } });
    withTransactionMock.mockImplementation(async (_db: unknown, cb: (t: unknown) => Promise<unknown>) => cb(trx));

    await expect(updateContactPortalAdminStatus('contact-1', true)).resolves.toEqual({
      success: false,
      error: PORTAL_ADMIN_REFUSAL,
    });
    expect(contactUpdate).not.toHaveBeenCalled();
    // Only the contact's own portal user counts; an internal user that happens
    // to share the contact row must not block the pre-seed.
    expect(userWhere).toHaveBeenCalledWith({ contact_id: 'contact-1', user_type: 'client' });
  });

  it('refuses turning the flag off too — the role is the switch from then on', async () => {
    const { trx, contactUpdate } = buildTrx({ portalUser: { user_id: 'user-9' } });
    withTransactionMock.mockImplementation(async (_db: unknown, cb: (t: unknown) => Promise<unknown>) => cb(trx));

    await expect(updateContactPortalAdminStatus('contact-1', false)).resolves.toEqual({
      success: false,
      error: PORTAL_ADMIN_REFUSAL,
    });
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it('still sets the pre-seed for a contact with no portal user', async () => {
    const { trx, contactUpdate } = buildTrx({ portalUser: undefined });
    withTransactionMock.mockImplementation(async (_db: unknown, cb: (t: unknown) => Promise<unknown>) => cb(trx));

    await expect(updateContactPortalAdminStatus('contact-1', true)).resolves.toEqual({ success: true });
    expect(contactUpdate).toHaveBeenCalledTimes(1);
    expect(contactUpdate.mock.calls[0][0]).toMatchObject({ is_client_admin: true });
  });

  it('still clears the pre-seed for a contact with no portal user', async () => {
    const { trx, contactUpdate } = buildTrx({ portalUser: undefined });
    withTransactionMock.mockImplementation(async (_db: unknown, cb: (t: unknown) => Promise<unknown>) => cb(trx));

    await expect(updateContactPortalAdminStatus('contact-1', false)).resolves.toEqual({ success: true });
    expect(contactUpdate.mock.calls[0][0]).toMatchObject({ is_client_admin: false });
  });

  it('keeps refusing a shared mailbox before it looks for a portal user', async () => {
    const { trx, contactUpdate, userWhere } = buildTrx({ portalUser: undefined });
    withTransactionMock.mockImplementation(async (_db: unknown, cb: (t: unknown) => Promise<unknown>) => cb(trx));
    assertContactIsNotSharedMailboxMock.mockRejectedValueOnce(
      new Error('Shared mailbox contacts cannot be client admins.') as never
    );

    await expect(updateContactPortalAdminStatus('contact-1', true)).resolves.toMatchObject({ success: false });
    expect(userWhere).not.toHaveBeenCalled();
    expect(contactUpdate).not.toHaveBeenCalled();
  });
});
