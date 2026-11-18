import { beforeEach, describe, expect, it, vi } from 'vitest';

// The client-scope create gate needs a real connection; it is covered by the T008 integration test.
vi.mock('@alga-psa/authorization/recordCreateAuthorization', () => ({ assertRecordCreateAllowed: vi.fn(async () => undefined) }));

const createTenantKnexMock = vi.fn(async () => ({ knex: {} as any }));
const withTransactionMock = vi.fn();
const assertMspPermissionMock = vi.fn();
const createContactMock = vi.fn();
const getContactByIdMock = vi.fn();
const updateContactMock = vi.fn();
const permitsMock = vi.fn();
const resolveOwnershipMock = vi.fn();
const hasMspPermissionMock = vi.fn();

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

// The read-scope check the conflict message uses to decide whether it may name the owner's client.
vi.mock('@alga-psa/authorization/clientScopeAuthorization', () => ({
  createClientScopeContext: vi.fn(async () => ({
    permits: (...args: any[]) => permitsMock(...args),
    narrowing: async () => ({ narrowed: false, apply: (query: any) => query }),
  })),
}));

// The resolver has its own suites; here it only supplies the owner the update pre-check would find.
vi.mock('@alga-psa/shared/models/contactEmailOwnership', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  resolveContactEmailOwnership: (...args: any[]) => resolveOwnershipMock(...args),
}));

vi.mock('../../lib/authHelpers', () => ({
  assertMspPermission: (...args: any[]) => assertMspPermissionMock(...args),
  hasMspPermission: (...args: any[]) => hasMspPermissionMock(...args),
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
  buildContactUpdatedPayload: vi.fn(),
}));

// Static import (vi.mock calls are hoisted above it): the module graph is loaded once at
// collection time instead of inside a test body, where a cold import under CI load can
// exceed the per-test timeout.
import { addContact, updateContact } from './contactActions';
import { EmailOwnershipError } from '@alga-psa/shared/models/contactEmailOwnership';

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
    // clearAllMocks keeps queued *Once implementations; reset them so a value queued by one
    // test can never be consumed by the next.
    for (const mock of [assertMspPermissionMock, createContactMock, getContactByIdMock, updateContactMock, permitsMock, resolveOwnershipMock, hasMspPermissionMock]) {
      mock.mockReset();
    }
    assertMspPermissionMock.mockResolvedValue(undefined);
    hasMspPermissionMock.mockResolvedValue(true);
    permitsMock.mockResolvedValue(true);
    resolveOwnershipMock.mockResolvedValue(null);
    withTransactionMock.mockImplementation(async (_db: unknown, callback: (trx: unknown) => Promise<unknown>) =>
      callback({} as any)
    );
  });

  it('returns a create-contact EMAIL_EXISTS result for duplicate additional email addresses', async () => {
    createContactMock.mockRejectedValueOnce(additionalEmailUniqueError());

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

  describe('names the contact that owns the email', () => {
    const owner = (overrides: Record<string, unknown> = {}) => ({
      kind: 'primary' as const,
      email: 'owner@example.com',
      contactNameId: 'owner-1',
      clientId: 'client-other',
      fullName: 'Benjamin Dixon',
      clientName: 'Muscle Corp',
      isInactive: false,
      ...overrides,
    });
    const addAlice = () => addContact({ full_name: 'Alice Example', email: 'ben@muscle.ca' });

    it('cross-client owner: names the contact and the client when the caller may read that client', async () => {
      createContactMock.mockRejectedValueOnce(new EmailOwnershipError(owner()));

      await expect(addAlice()).resolves.toEqual({
        success: false,
        error: 'EMAIL_EXISTS: This email address already belongs to Benjamin Dixon at Muscle Corp.',
      });
      expect(permitsMock).toHaveBeenCalledWith('client', 'client-other');
    });

    it('cross-client owner: says "another client" and names neither contact nor client when the caller is out of scope', async () => {
      createContactMock.mockRejectedValueOnce(new EmailOwnershipError(owner()));
      permitsMock.mockImplementation(async (resource: string) => resource !== 'client');

      const result = await addAlice();

      expect(result).toEqual({
        success: false,
        error: 'EMAIL_EXISTS: This email address already belongs to a contact at another client.',
      });
      expect(JSON.stringify(result)).not.toMatch(/Benjamin|Muscle/);
    });

    it('redacts when the caller lacks client read permission altogether', async () => {
      createContactMock.mockRejectedValueOnce(new EmailOwnershipError(owner()));
      hasMspPermissionMock.mockResolvedValue(false);

      const result = await addAlice();

      expect(result).toMatchObject({ error: 'EMAIL_EXISTS: This email address already belongs to a contact at another client.' });
      expect(permitsMock).not.toHaveBeenCalled();
    });

    it('redacts when the visibility check itself fails: an undecidable scope never widens the message', async () => {
      createContactMock.mockRejectedValueOnce(new EmailOwnershipError(owner()));
      permitsMock.mockRejectedValue(new Error('scope unavailable'));

      await expect(addAlice()).resolves.toMatchObject({
        error: 'EMAIL_EXISTS: This email address already belongs to a contact at another client.',
      });
    });

    it('additional-email owner: says the address is an additional email on the named contact', async () => {
      createContactMock.mockRejectedValueOnce(new EmailOwnershipError(owner({ kind: 'additional' })));

      await expect(addAlice()).resolves.toEqual({
        success: false,
        error: 'EMAIL_EXISTS: This email address is already an additional email address on Benjamin Dixon at Muscle Corp.',
      });
    });

    it('inactive owner: says the owning contact is inactive', async () => {
      createContactMock.mockRejectedValueOnce(new EmailOwnershipError(owner({ isInactive: true })));

      await expect(addAlice()).resolves.toEqual({
        success: false,
        error: 'EMAIL_EXISTS: This email address already belongs to Benjamin Dixon at Muscle Corp, an inactive contact. Reactivate that contact instead.',
      });
    });

    it('owner with no client is named without a client', async () => {
      createContactMock.mockRejectedValueOnce(new EmailOwnershipError(owner({ clientId: null, clientName: null })));

      await expect(addAlice()).resolves.toMatchObject({
        error: 'EMAIL_EXISTS: This email address already belongs to Benjamin Dixon, a contact with no client.',
      });
    });

    it('no add path leaves the bare generic text: a raw constraint race still resolves the owner', async () => {
      createContactMock.mockRejectedValueOnce(additionalEmailUniqueError());
      resolveOwnershipMock.mockResolvedValueOnce(owner());

      const result = await addContact({
        full_name: 'Alice Example',
        email: 'alice@example.com',
        additional_email_addresses: [{ email_address: 'ben@muscle.ca', canonical_type: 'work' }],
      });

      expect(result).toEqual({
        success: false,
        error: 'EMAIL_EXISTS: This email address already belongs to Benjamin Dixon at Muscle Corp.',
      });
    });

    it('updateContact: a structured conflict from the model reaches the editor as a named action error', async () => {
      getContactByIdMock.mockResolvedValueOnce({ contact_name_id: 'contact-1', email: 'alice@example.com', additional_email_addresses: [] });
      updateContactMock.mockRejectedValueOnce(new EmailOwnershipError(owner()));

      await expect(updateContact({ contact_name_id: 'contact-1', full_name: 'Alice Example' })).resolves.toEqual({
        actionError: 'This email address already belongs to Benjamin Dixon at Muscle Corp.',
      });
    });

    it('updateContact: the pre-check on a changed email names the owner instead of the generic text', async () => {
      resolveOwnershipMock.mockResolvedValueOnce(owner({ clientId: 'client-other' }));
      permitsMock.mockImplementation(async (resource: string) => resource !== 'client');

      await expect(updateContact({ contact_name_id: 'contact-1', full_name: 'Alice Example', email: 'ben@muscle.ca' })).resolves.toEqual({
        actionError: 'This email address already belongs to a contact at another client.',
      });
      expect(updateContactMock).not.toHaveBeenCalled();
    });

    it('updateContact: an email owned by the contact being edited is not a conflict', async () => {
      resolveOwnershipMock.mockResolvedValue(owner({ contactNameId: 'contact-1' }));
      getContactByIdMock.mockResolvedValue({ contact_name_id: 'contact-1', email: 'alice@example.com', additional_email_addresses: [] });
      updateContactMock.mockResolvedValue({ contact_name_id: 'contact-1', email: 'alice@example.com', additional_email_addresses: [] });

      // Later steps (location hydration) are outside this test's doubles; the point is that the pre-check let the save through.
      await updateContact({ contact_name_id: 'contact-1', full_name: 'Alice Example', email: 'alice@example.com' }).catch(() => undefined);

      expect(updateContactMock).toHaveBeenCalledTimes(1);
    });
  });
});
