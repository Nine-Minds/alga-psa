import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const withTransactionMock = vi.hoisted(() => vi.fn());
const deleteEntityWithValidationMock = vi.hoisted(() => vi.fn());
const preCheckDeletionMock = vi.hoisted(() => vi.fn());
const hasPermissionAsyncMock = vi.hoisted(() => vi.fn());
const deleteEntityTagsMock = vi.hoisted(() => vi.fn());
const isEnterpriseRef = vi.hoisted(() => ({ value: false }));
const authUserRef = vi.hoisted(() => ({
  value: {
    user_id: 'user-1',
    user_type: 'internal' as 'internal' | 'client',
    clientId: undefined as string | undefined,
    contact_id: undefined as string | undefined,
  },
}));

type ServerAction = (...args: unknown[]) => unknown;
type LookupTransaction = (table: string) => {
  where: ReturnType<typeof vi.fn>;
};
type TransactionCallback = (trx: LookupTransaction) => Promise<unknown>;

vi.mock('@alga-psa/auth', () => ({
  preCheckDeletion: preCheckDeletionMock,
  withAuth: (fn: ServerAction) => (...args: unknown[]) =>
    fn(authUserRef.value, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/core', () => ({
  deleteEntityWithValidation: deleteEntityWithValidationMock,
  unparseCSV: vi.fn(),
  get isEnterprise() {
    return isEnterpriseRef.value;
  },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  withTransaction: withTransactionMock,
}));

vi.mock('../lib/authHelpers', () => ({
  hasPermissionAsync: hasPermissionAsyncMock,
  isClientPortalUser: (user: any) => user?.user_type === 'client',
  hasMspPermission: async (user: any, resource: string, action: string, db?: any) =>
    user?.user_type === 'internal' && await hasPermissionAsyncMock(user, resource, action, db),
  assertMspPermission: async (user: any, resource: string, action: string, message: string, db?: any) => {
    if (!(user?.user_type === 'internal' && await hasPermissionAsyncMock(user, resource, action, db))) {
      throw new Error(message);
    }
  },
  hasMspOrClientPortalOwnClientPermission: async (user: any, _tenant: string, _clientId: string, resource: string, action: string, db?: any) =>
    (user?.user_type === 'internal' || (user?.user_type === 'client' && user?.clientId === _clientId))
      && await hasPermissionAsyncMock(user, resource, action, db),
  assertMspOrClientPortalOwnClientPermission: async (user: any, _tenant: string, _clientId: string, resource: string, action: string, message: string, db?: any) => {
    if (!((user?.user_type === 'internal' || (user?.user_type === 'client' && user?.clientId === _clientId))
      && await hasPermissionAsyncMock(user, resource, action, db))) {
      throw new Error(message);
    }
  },
}));

vi.mock('../lib/billingHelpers', () => ({
  createDefaultTaxSettingsAsync: vi.fn(),
}));

vi.mock('../lib/documentsHelpers', () => ({
  getClientLogoUrlAsync: vi.fn(),
  getClientLogoUrlsBatchAsync: vi.fn(),
}));

vi.mock('@alga-psa/storage', () => ({
  uploadEntityImage: vi.fn(),
  deleteEntityImage: vi.fn(),
}));

vi.mock('@alga-psa/tags/actions', () => ({
  createTag: vi.fn(),
}));

vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({
  deleteEntityTags: deleteEntityTagsMock,
}));

vi.mock('@alga-psa/shared/models/clientModel', () => ({
  ClientModel: {},
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('@alga-psa/workflow-streams', () => ({
  buildClientArchivedPayload: vi.fn(),
  buildClientCreatedPayload: vi.fn(),
  buildClientOwnerAssignedPayload: vi.fn(),
  buildClientStatusChangedPayload: vi.fn(),
  buildClientUpdatedPayload: vi.fn(() => ({ updatedFields: [], changes: {} })),
  buildContactPrimarySetPayload: vi.fn(),
}));

vi.mock('@alga-psa/shared/billingClients/defaultContract', () => ({
  ensureDefaultContractForClientIfBillingConfigured: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

function createLookupTrx(input: {
  client?: { client_id: string; is_inactive?: boolean } | null;
  isDefaultClient?: boolean;
}): LookupTransaction {
  return ((table: string) => {
    if (table === 'clients') {
      return {
        where: vi.fn(() => ({
          first: vi.fn(async () => input.client ?? null),
        })),
      };
    }

    if (table === 'tenant_companies') {
      return {
        where: vi.fn(() => ({
          first: vi.fn(async () => (input.isDefaultClient ? { client_id: 'client-1' } : null)),
        })),
      };
    }

    throw new Error(`Unexpected lookup table ${table}`);
  }) as LookupTransaction;
}

function primeClientLookup(input: {
  client?: { client_id: string; is_inactive?: boolean } | null;
  isDefaultClient?: boolean;
}) {
  createTenantKnexMock.mockResolvedValue({ knex: {} });
  withTransactionMock.mockImplementation(async (_db: unknown, callback: TransactionCallback) =>
    callback(createLookupTrx(input))
  );
}

describe('client deletion actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authUserRef.value = {
      user_id: 'user-1',
      user_type: 'internal',
      clientId: undefined,
      contact_id: undefined,
    };
    isEnterpriseRef.value = false;
    hasPermissionAsyncMock.mockResolvedValue(true);
    preCheckDeletionMock.mockResolvedValue({
      canDelete: true,
      dependencies: [],
      alternatives: [],
    });
    deleteEntityWithValidationMock.mockResolvedValue({
      canDelete: true,
      deleted: true,
      dependencies: [],
      alternatives: [],
    });
  });

  describe('updateClient', () => {
    it('limits client portal updates to self-service client fields', async () => {
      authUserRef.value = {
        user_id: 'client-user-1',
        user_type: 'client',
        clientId: 'client-1',
        contact_id: 'contact-1',
      };

      const updateCalls: Record<string, unknown>[] = [];
      const currentClient = {
        client_id: 'client-1',
        client_name: 'Original Client',
        url: 'https://old.example',
        tenant: 'tenant-1',
        is_inactive: false,
        billing_contact_id: 'billing-contact-1',
        billing_email: 'billing@example.com',
        properties: {
          website: 'https://old.example',
          industry: 'Original Industry',
          status: 'active',
          tax_id: 'server-tax-id',
        },
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      };

      createTenantKnexMock.mockResolvedValue({ knex: {} });
      withTransactionMock.mockImplementation(async (_db: unknown, callback: TransactionCallback) => {
        const trx = ((table: string) => {
          if (table !== 'clients') {
            throw new Error(`Unexpected table ${table}`);
          }

          return {
            where: vi.fn(() => ({
              first: vi.fn(async () => currentClient),
              update: vi.fn((updateObject: Record<string, unknown>) => {
                updateCalls.push(updateObject);
                return {
                  returning: vi.fn(async () => [{
                    ...currentClient,
                    ...updateObject,
                  }]),
                };
              }),
            })),
          };
        }) as LookupTransaction;

        return callback(trx);
      });

      const { updateClient } = await import('./clientActions');
      await updateClient('client-1', {
        client_name: 'Portal Updated Client',
        url: 'https://new.example',
        is_inactive: true,
        billing_contact_id: 'attacker-contact',
        billing_email: 'attacker@example.com',
        properties: {
          website: 'https://new.example',
          industry: 'New Industry',
          status: 'inactive',
          tax_id: 'attacker-tax-id',
        },
      } as any);

      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0]).toMatchObject({
        client_name: 'Portal Updated Client',
        url: 'https://new.example',
        properties: {
          website: 'https://new.example',
          industry: 'New Industry',
          status: 'active',
          tax_id: 'server-tax-id',
        },
      });
      expect(updateCalls[0]).not.toHaveProperty('is_inactive');
      expect(updateCalls[0]).not.toHaveProperty('billing_contact_id');
      expect(updateCalls[0]).not.toHaveProperty('billing_email');
    });
  });

  describe('validateClientDeletion', () => {
    it('returns PERMISSION_DENIED before opening tenant DB access when delete permission is missing', async () => {
      hasPermissionAsyncMock.mockResolvedValue(false);

      const { validateClientDeletion } = await import('./clientActions');
      const result = await validateClientDeletion('client-1');

      expect(result).toMatchObject({
        canDelete: false,
        code: 'PERMISSION_DENIED',
        dependencies: [],
        alternatives: [],
      });
      expect(createTenantKnexMock).not.toHaveBeenCalled();
      expect(preCheckDeletionMock).not.toHaveBeenCalled();
    });

    it('returns NOT_FOUND without running dependency precheck when the client does not exist', async () => {
      primeClientLookup({ client: null });

      const { validateClientDeletion } = await import('./clientActions');
      const result = await validateClientDeletion('missing-client');

      expect(result).toMatchObject({
        canDelete: false,
        code: 'NOT_FOUND',
        message: 'Client not found.',
      });
      expect(preCheckDeletionMock).not.toHaveBeenCalled();
    });

    it('returns IS_DEFAULT without running dependency precheck for the default client', async () => {
      primeClientLookup({
        client: { client_id: 'client-1', is_inactive: false },
        isDefaultClient: true,
      });

      const { validateClientDeletion } = await import('./clientActions');
      const result = await validateClientDeletion('client-1');

      expect(result).toMatchObject({
        canDelete: false,
        code: 'IS_DEFAULT',
      });
      expect(preCheckDeletionMock).not.toHaveBeenCalled();
    });

    it('runs client dependency precheck and splits deactivate alternatives when active contacts block deletion', async () => {
      primeClientLookup({
        client: { client_id: 'client-1', is_inactive: false },
        isDefaultClient: false,
      });
      preCheckDeletionMock.mockResolvedValue({
        canDelete: false,
        code: 'DEPENDENCIES_EXIST',
        message: 'Blocked',
        dependencies: [{ type: 'contact', count: 2, label: 'contacts' }],
        alternatives: [{ action: 'deactivate', label: 'Mark as Inactive', warning: 'Keeps data' }],
      });

      const { validateClientDeletion } = await import('./clientActions');
      const result = await validateClientDeletion('client-1');

      expect(preCheckDeletionMock).toHaveBeenCalledWith('client', 'client-1');
      expect(result.alternatives).toEqual([
        {
          action: 'deactivate_client_only',
          label: 'Client Only',
          description: 'Deactivate the client but leave its contacts active.',
          warning: 'Keeps data',
        },
        {
          action: 'deactivate',
          label: 'Client & Contacts',
          warning: 'Keeps data',
        },
      ]);
    });

    it('removes no-op deactivate alternatives when the client is already inactive', async () => {
      primeClientLookup({
        client: { client_id: 'client-1', is_inactive: true },
        isDefaultClient: false,
      });
      preCheckDeletionMock.mockResolvedValue({
        canDelete: false,
        code: 'DEPENDENCIES_EXIST',
        message: 'Blocked',
        dependencies: [{ type: 'ticket', count: 1, label: 'ticket' }],
        alternatives: [{ action: 'deactivate', label: 'Mark as Inactive' }],
      });

      const { validateClientDeletion } = await import('./clientActions');
      const result = await validateClientDeletion('client-1');

      expect(result.alternatives).toEqual([]);
    });
  });

  describe('deleteClient', () => {
    it('throws before opening tenant DB access when delete permission is missing', async () => {
      hasPermissionAsyncMock.mockResolvedValue(false);

      const { deleteClient } = await import('./clientActions');

      await expect(deleteClient('client-1')).rejects.toThrow('Permission denied: Cannot delete clients');
      expect(createTenantKnexMock).not.toHaveBeenCalled();
      expect(deleteEntityWithValidationMock).not.toHaveBeenCalled();
    });

    it('returns NOT_FOUND without invoking atomic deletion when the client does not exist', async () => {
      primeClientLookup({ client: null });

      const { deleteClient } = await import('./clientActions');
      const result = await deleteClient('missing-client');

      expect(result).toMatchObject({
        success: false,
        canDelete: false,
        code: 'NOT_FOUND',
      });
      expect(deleteEntityWithValidationMock).not.toHaveBeenCalled();
    });

    it('returns IS_DEFAULT without invoking atomic deletion for the default client', async () => {
      primeClientLookup({
        client: { client_id: 'client-1', is_inactive: false },
        isDefaultClient: true,
      });

      const { deleteClient } = await import('./clientActions');
      const result = await deleteClient('client-1');

      expect(result).toMatchObject({
        success: false,
        canDelete: false,
        code: 'IS_DEFAULT',
      });
      expect(deleteEntityWithValidationMock).not.toHaveBeenCalled();
    });

    it('uses atomic deletion and returns success with dependency counts when deletion passes', async () => {
      primeClientLookup({
        client: { client_id: 'client-1', is_inactive: false },
        isDefaultClient: false,
      });
      deleteEntityWithValidationMock.mockResolvedValue({
        canDelete: true,
        deleted: true,
        dependencies: [
          { type: 'contact', count: 0, label: 'contacts' },
          { type: 'ticket', count: 0, label: 'tickets' },
        ],
        alternatives: [],
      });

      const { deleteClient } = await import('./clientActions');
      const result = await deleteClient('client-1');

      expect(deleteEntityWithValidationMock).toHaveBeenCalledWith(
        'client',
        'client-1',
        {},
        'tenant-1',
        expect.any(Function)
      );
      expect(result).toMatchObject({
        success: true,
        deleted: true,
        counts: { contact: 0, ticket: 0 },
      });
    });

    it('returns blocked validation result and tailored alternatives when atomic deletion finds dependencies', async () => {
      primeClientLookup({
        client: { client_id: 'client-1', is_inactive: false },
        isDefaultClient: false,
      });
      deleteEntityWithValidationMock.mockResolvedValue({
        canDelete: false,
        deleted: false,
        code: 'DEPENDENCIES_EXIST',
        message: 'Blocked',
        dependencies: [{ type: 'contact', count: 1, label: 'contact' }],
        alternatives: [{ action: 'deactivate', label: 'Mark as Inactive' }],
      });

      const { deleteClient } = await import('./clientActions');
      const result = await deleteClient('client-1');

      expect(result).toMatchObject({
        success: false,
        deleted: false,
        canDelete: false,
        code: 'DEPENDENCIES_EXIST',
        counts: { contact: 1 },
      });
      expect(result.alternatives.map((alternative) => alternative.action)).toEqual([
        'deactivate_client_only',
        'deactivate',
      ]);
    });
  });
});
