import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The REST delete used to drop the contact row with no dependency check at all,
 * which is how a live portal user ends up orphaned: its contact is gone, so the
 * person can neither sign in nor be invited again. The API path now runs the
 * same `deleteEntityWithValidation` gate and the same shared cascade as the MSP
 * action.
 */

const CONTACT = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';

const deleteEntityWithValidationMock = vi.hoisted(() => vi.fn());
const deleteContactCascadeMock = vi.hoisted(() => vi.fn(async () => 1));
const deleteEntityTagsMock = vi.hoisted(() => vi.fn(async () => 0));
const getContactByIdMock = vi.hoisted(() => vi.fn());
const publishNonCatalogWorkflowEventMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@alga-psa/authorization/clientScopeAuthorization', () => ({
  createClientScopeContext: async () => ({
    narrowing: async () => ({ narrowed: false, apply: (query: unknown) => query }),
    permits: async () => true,
  }),
}));
vi.mock('@alga-psa/authorization/recordCreateAuthorization', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  assertRecordCreateAllowed: async () => undefined,
}));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    withTransaction: async (_knex: unknown, callback: (trx: any) => Promise<any>) =>
      callback({ transactionId: 'trx-1' }),
  };
});

vi.mock('@alga-psa/core/server', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  deleteEntityWithValidation: (...args: unknown[]) => deleteEntityWithValidationMock(...args),
}));

vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({
  deleteEntityTags: (...args: unknown[]) => deleteEntityTagsMock(...args),
}));

vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getContactAvatarUrl: vi.fn().mockResolvedValue(null),
}));

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: (...args: unknown[]) => publishNonCatalogWorkflowEventMock(...args),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/shared/workflow/streams/domainEventBuilders/contactEventBuilders', () => ({
  buildContactCreatedPayload: vi.fn(() => ({ event: 'created' })),
  buildContactUpdatedPayload: vi.fn(() => ({ updatedFields: [], changes: {} })),
  buildContactArchivedPayload: vi.fn(() => ({ event: 'archived' })),
}));

vi.mock('@alga-psa/shared/models/contactLocation', () => ({
  getContactLocationsForContacts: vi.fn(async () => new Map()),
}));

vi.mock('@alga-psa/clients/models/contactLocation', () => ({
  replaceContactLocations: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/shared/models/contactModel', () => ({
  ContactModel: {
    createContact: vi.fn(),
    getContactById: (...args: any[]) => getContactByIdMock(...args),
    updateContact: vi.fn(),
    hydrateContactsWithPhoneNumbers: vi.fn(),
  },
  deleteContactCascade: (...args: unknown[]) => deleteContactCascadeMock(...(args as [])),
}));

async function service() {
  const { ContactService } = await import('../../../lib/api/services/ContactService');
  const instance = new ContactService();
  vi.spyOn(instance as any, 'getKnex').mockResolvedValue({ knex: {}, tenant: 'tenant-1' });
  return instance;
}

const context = { tenant: 'tenant-1', userId: 'user-1' } as any;

const blocked = {
  canDelete: false,
  code: 'DEPENDENCIES_EXIST',
  message: 'Cannot delete contact: 1 portal user account exists',
  dependencies: [{ type: 'portal_user', count: 1, label: 'portal user account' }],
  alternatives: ['Deactivate the contact instead'],
};

describe('ContactService.delete dependency validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getContactByIdMock.mockResolvedValue({ contact_name_id: CONTACT, client_id: CLIENT });
    deleteContactCascadeMock.mockResolvedValue(1);
    deleteEntityWithValidationMock.mockImplementation(
      async (
        _type: string,
        _id: string,
        _knex: unknown,
        tenant: string,
        performDelete: (trx: unknown, tenant: string) => Promise<void>
      ) => {
        await performDelete({ transactionId: 'cascade-trx' }, tenant);
        return { canDelete: true, dependencies: [], alternatives: [], deleted: true };
      }
    );
  });

  it('refuses with a 409 and leaves the contact alone when a portal user depends on it', async () => {
    deleteEntityWithValidationMock.mockResolvedValue(blocked);

    const error = await (await service()).delete(CONTACT, context).catch((caught: any) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ConflictError');
    expect(error.statusCode).toBe(409);
    expect(error.message).toContain('portal user account');
    expect(error.details).toMatchObject({
      code: 'DEPENDENCIES_EXIST',
      dependencies: [{ type: 'portal_user', count: 1, label: 'portal user account' }],
    });
    expect(deleteContactCascadeMock).not.toHaveBeenCalled();
    expect(publishNonCatalogWorkflowEventMock).not.toHaveBeenCalled();
  });

  it('runs the shared cascade with tag cleanup and announces the delete when nothing blocks', async () => {
    await (await service()).delete(CONTACT, context);

    expect(deleteEntityWithValidationMock).toHaveBeenCalledWith(
      'contact',
      CONTACT,
      expect.anything(),
      'tenant-1',
      expect.any(Function)
    );
    expect(deleteContactCascadeMock).toHaveBeenCalledWith(
      { transactionId: 'cascade-trx' },
      'tenant-1',
      CONTACT,
      expect.objectContaining({ deleteTags: expect.any(Function) })
    );

    // The tag hook is what lets the shared cascade live in `shared/`, which cannot
    // depend on @alga-psa/tags.
    const [, , , options] = deleteContactCascadeMock.mock.calls[0] as any[];
    await options.deleteTags({ transactionId: 'cascade-trx' }, CONTACT);
    expect(deleteEntityTagsMock).toHaveBeenCalledWith({ transactionId: 'cascade-trx' }, CONTACT, 'contact');

    expect(publishNonCatalogWorkflowEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'CONTACT_DELETED' })
    );
  });

  it('reports a contact that vanished mid-cascade as not found', async () => {
    deleteContactCascadeMock.mockResolvedValue(0);

    const error = await (await service()).delete(CONTACT, context).catch((caught: any) => caught);

    expect(error.name).toBe('NotFoundError');
    expect(publishNonCatalogWorkflowEventMock).not.toHaveBeenCalled();
  });
});
