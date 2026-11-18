import { beforeEach, describe, expect, it, vi } from 'vitest';

// The client-scope create gate needs a real connection; it is covered by the T008 integration test.
vi.mock('@alga-psa/authorization/recordCreateAuthorization', () => ({ assertRecordCreateAllowed: vi.fn(async () => undefined) }));

/**
 * The work-arrangement contract of the update action: `undefined` leaves the stored value alone,
 * while the editor's "Not set" (null) clears it. Collapsing null to undefined made "Not set" a
 * silent no-op, which is exactly the quiet data loss this feature exists to avoid.
 */
const createTenantKnexMock = vi.fn(async () => ({ knex: {} as any }));
const withTransactionMock = vi.fn();
const assertMspPermissionMock = vi.fn();
const getContactByIdMock = vi.fn();
const updateContactMock = vi.fn();
const createContactMock = vi.fn();
const replaceContactLocationsMock = vi.fn(async () => []);
const isContactLocationClientMismatchMock = vi.fn((_error: unknown) => false);

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
    createContact: (...args: any[]) => createContactMock(...args),
    getContactById: (...args: any[]) => getContactByIdMock(...args),
    updateContact: (...args: any[]) => updateContactMock(...args),
  },
}));

vi.mock('../../models/contactLocation', () => ({
  getContactLocationCount: vi.fn(async () => 0),
  getContactLocations: vi.fn(async () => []),
  isContactLocationClientMismatch: (error: unknown) => isContactLocationClientMismatchMock(error),
  replaceContactLocations: (...args: any[]) => replaceContactLocationsMock(...(args as [])),
}));

vi.mock('../../lib/contactLocations', () => ({
  attachContactLocations: vi.fn(async (_db: unknown, _tenant: string, rows: unknown[]) => rows),
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

vi.mock('@alga-psa/tags/actions', () => ({
  createTag: vi.fn(),
}));

vi.mock('@alga-psa/tags/actions/tagActions', () => ({
  createTagsForEntityWithTransaction: vi.fn(),
}));

vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({
  deleteEntityTags: vi.fn(),
}));

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

const storedContact = {
  contact_name_id: 'contact-1',
  tenant: 'tenant-1',
  full_name: 'Alice Example',
  client_id: 'client-1',
  email: 'alice@example.com',
  phone_numbers: [],
  additional_email_addresses: [],
  is_inactive: false,
  work_arrangement: 'remote',
  updated_at: '2026-10-30T00:00:00.000Z',
};

describe('updateContact work arrangement contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertMspPermissionMock.mockResolvedValue(undefined);
    withTransactionMock.mockImplementation(async (_db: unknown, callback: (trx: unknown) => Promise<unknown>) =>
      callback({} as any)
    );
    getContactByIdMock.mockResolvedValue({ ...storedContact });
    updateContactMock.mockImplementation(async (_id: string, input: any) => ({ ...storedContact, ...input }));
    createContactMock.mockImplementation(async (input: any) => ({ ...storedContact, ...input }));
    replaceContactLocationsMock.mockResolvedValue([] as never);
    isContactLocationClientMismatchMock.mockReturnValue(false);
  });

  it('clears the work arrangement when the editor sends null', async () => {
    const { updateContact } = await import('./contactActions');

    await updateContact({
      contact_name_id: 'contact-1',
      full_name: 'Alice Example',
      work_arrangement: null,
    } as any);

    expect(updateContactMock).toHaveBeenCalledTimes(1);
    expect(updateContactMock.mock.calls[0][1]).toMatchObject({ work_arrangement: null });
  });

  it('leaves the stored work arrangement alone when the field is absent', async () => {
    const { updateContact } = await import('./contactActions');

    await updateContact({
      contact_name_id: 'contact-1',
      full_name: 'Alice Example',
    } as any);

    expect(updateContactMock).toHaveBeenCalledTimes(1);
    expect(updateContactMock.mock.calls[0][1].work_arrangement).toBeUndefined();
  });

  it('passes a chosen work arrangement through unchanged', async () => {
    const { updateContact } = await import('./contactActions');

    await updateContact({
      contact_name_id: 'contact-1',
      full_name: 'Alice Example',
      work_arrangement: 'hybrid',
    } as any);

    expect(updateContactMock.mock.calls[0][1]).toMatchObject({ work_arrangement: 'hybrid' });
  });

  /**
   * The create path has its own error mapper, so the cross-client refusal has to be named there
   * too — otherwise the operator sees only "Failed to create contact" and no reason.
   */
  it('names a cross-client location when creating a contact', async () => {
    const mismatch = Object.assign(new Error('Location other-location belongs to another client'), {
      code: 'CONTACT_LOCATION_CLIENT_MISMATCH',
    });
    replaceContactLocationsMock.mockRejectedValueOnce(mismatch as never);
    isContactLocationClientMismatchMock.mockImplementation((error: unknown) => error === mismatch);

    const { addContact } = await import('./contactActions');
    const result = await addContact({
      full_name: 'Alice Example',
      email: 'alice@example.com',
      client_id: 'client-1',
      locations: [{ location_id: 'other-location', is_primary: true }],
    } as any);

    expect(result).toEqual({
      success: false,
      error: 'VALIDATION_ERROR: That location belongs to another client.',
    });
  });
});
