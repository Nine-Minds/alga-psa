import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.fn(async () => ({ knex: {} as any }));
const withTransactionMock = vi.fn();
const assertMspPermissionMock = vi.fn();
const createContactMock = vi.fn();
const getContactByIdMock = vi.fn();
const updateContactMock = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: () => createTenantKnexMock(),
  tenantDb: (conn: any) => ({
    table: (table: string) => conn(table),
  }),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
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

vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({
  deleteEntityTags: vi.fn(),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('@alga-psa/workflow-streams', () => ({
  buildContactArchivedPayload: vi.fn(),
  buildContactCreatedPayload: vi.fn(),
  buildContactUpdatedPayload: vi.fn(),
}));

function additionalEmailUniqueError() {
  return Object.assign(
    new Error('duplicate key value violates unique constraint "ux_contact_additional_email_addresses_tenant_normalized_email"'),
    {
      code: '23505',
      constraint: 'ux_contact_additional_email_addresses_tenant_normalized_email',
    }
  );
}

describe('contact action email conflict handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertMspPermissionMock.mockResolvedValue(undefined);
    withTransactionMock.mockImplementation(async (_db: unknown, callback: (trx: unknown) => Promise<unknown>) =>
      callback({} as any)
    );
  });

  it('returns a create-contact EMAIL_EXISTS result for duplicate additional email addresses', async () => {
    createContactMock.mockRejectedValueOnce(additionalEmailUniqueError());

    const { addContact } = await import('./contactActions');

    await expect(addContact({
      full_name: 'Alice Example',
      email: 'alice@example.com',
      additional_email_addresses: [
        { email_address: 'billing@example.com', canonical_type: 'work' },
      ],
    })).resolves.toEqual({
      success: false,
      error: 'EMAIL_EXISTS: A contact with this email address already exists in the system',
    });
  });

  it('returns a create-contact permission result when the caller cannot create contacts', async () => {
    assertMspPermissionMock.mockRejectedValueOnce(new Error('Permission denied: Cannot create contacts'));

    const { addContact } = await import('./contactActions');

    await expect(addContact({
      full_name: 'Alice Example',
      email: 'alice@example.com',
    })).resolves.toEqual({
      success: false,
      error: 'Permission denied: Cannot create contacts',
    });

    expect(createContactMock).not.toHaveBeenCalled();
  });

  it('returns an update-contact action error for duplicate additional email addresses', async () => {
    getContactByIdMock.mockResolvedValueOnce({
      contact_name_id: 'contact-1',
      email: 'alice@example.com',
      additional_email_addresses: [],
    });
    updateContactMock.mockRejectedValueOnce(additionalEmailUniqueError());

    const { updateContact } = await import('./contactActions');

    await expect(updateContact({
      contact_name_id: 'contact-1',
      full_name: 'Alice Example',
      additional_email_addresses: [
        { email_address: 'billing@example.com', canonical_type: 'work' },
      ],
    })).resolves.toEqual({
      actionError: 'A contact with this email address already exists in the system',
    });
  });
});
