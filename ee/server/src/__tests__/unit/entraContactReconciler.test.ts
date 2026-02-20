import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntraSyncUser } from '@ee/lib/integrations/entra/sync/types';

const createTenantKnexMock = vi.fn();
const runWithTenantMock = vi.fn();
const findContactMatchesByEmailMock = vi.fn();
const upsertEntraContactLinkActiveMock = vi.fn();
const queueAmbiguousEntraMatchMock = vi.fn();
const createContactMock = vi.fn();

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
  runWithTenant: runWithTenantMock,
}));

vi.mock('@ee/lib/integrations/entra/sync/contactMatcher', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@ee/lib/integrations/entra/sync/contactMatcher')>();
  return {
    ...actual,
    findContactMatchesByEmail: findContactMatchesByEmailMock,
  };
});

vi.mock('@ee/lib/integrations/entra/sync/contactLinkRepository', () => ({
  upsertEntraContactLinkActive: upsertEntraContactLinkActiveMock,
}));

vi.mock('@ee/lib/integrations/entra/reconciliationQueueService', () => ({
  queueAmbiguousEntraMatch: queueAmbiguousEntraMatchMock,
}));

vi.mock('@alga-psa/shared/models/contactModel', () => ({
  ContactModel: {
    createContact: createContactMock,
  },
}));

type KnexHarness = {
  contactsUpdateMock: ReturnType<typeof vi.fn>;
};

function setupReconcilerKnexHarness(params?: {
  existingLinkedContactId?: string | null;
  existingClientContactId?: string | null;
}): KnexHarness {
  const existingLinkedContactId = params?.existingLinkedContactId || null;
  const existingClientContactId = params?.existingClientContactId || null;

  const contactsUpdateMock = vi.fn(async () => 1);
  const contactsFirstMock = vi.fn(async () =>
    existingClientContactId ? { contact_name_id: existingClientContactId } : null
  );
  const linkedFirstMock = vi.fn(async () =>
    existingLinkedContactId ? { contact_name_id: existingLinkedContactId } : null
  );

  const trxMock = vi.fn((table: string) => {
    if (table === 'entra_contact_links') {
      const chain = {
        orderBy: vi.fn(),
        first: linkedFirstMock,
      };
      chain.orderBy.mockReturnValue(chain);
      return {
        where: vi.fn(() => chain),
      };
    }

    if (table === 'contacts') {
      const chain = {
        andWhereRaw: vi.fn(),
        orderBy: vi.fn(),
        first: contactsFirstMock,
        update: contactsUpdateMock,
      };
      chain.andWhereRaw.mockReturnValue(chain);
      chain.orderBy.mockReturnValue(chain);
      return {
        where: vi.fn(() => chain),
      };
    }

    throw new Error(`Unexpected table ${table}`);
  }) as any;

  trxMock.fn = { now: vi.fn(() => 'db-now') };
  trxMock.raw = vi.fn(() => 'RAW');

  const knexMock = {
    fn: { now: vi.fn(() => 'db-now') },
    transaction: vi.fn(async (cb: (trx: typeof trxMock) => Promise<unknown>) => cb(trxMock)),
  };
  createTenantKnexMock.mockResolvedValue({ knex: knexMock });

  return {
    contactsUpdateMock,
  };
}

function buildUser(overrides: Partial<EntraSyncUser> = {}): EntraSyncUser {
  return {
    entraTenantId: 'entra-tenant',
    entraObjectId: 'entra-object',
    userPrincipalName: 'user@example.com',
    email: 'user@example.com',
    displayName: 'Example User',
    givenName: 'Example',
    surname: 'User',
    accountEnabled: true,
    jobTitle: 'Engineer',
    mobilePhone: null,
    businessPhones: [],
    raw: {},
    ...overrides,
  };
}

describe('reconcileEntraUserToContact', () => {
  beforeEach(() => {
    vi.resetModules();
    createTenantKnexMock.mockReset();
    runWithTenantMock.mockReset();
    findContactMatchesByEmailMock.mockReset();
    upsertEntraContactLinkActiveMock.mockReset();
    queueAmbiguousEntraMatchMock.mockReset();
    createContactMock.mockReset();

    runWithTenantMock.mockImplementation(async (_tenant: string, fn: () => Promise<unknown>) => fn());
    upsertEntraContactLinkActiveMock.mockResolvedValue(undefined);
    queueAmbiguousEntraMatchMock.mockResolvedValue({ queueItemId: 'queue-default' });
    createContactMock.mockResolvedValue({ contact_name_id: 'contact-created' });
  });

  it('T095: exact email match links existing contact and does not create duplicate contact', async () => {
    const harness = setupReconcilerKnexHarness();
    findContactMatchesByEmailMock.mockResolvedValue([
      {
        contactNameId: 'contact-95',
        clientId: 'client-95',
        email: 'user95@example.com',
        fullName: 'User 95',
        isInactive: false,
      },
    ]);

    const { reconcileEntraUserToContact } = await import(
      '@ee/lib/integrations/entra/sync/contactReconciler'
    );
    const result = await reconcileEntraUserToContact({
      tenantId: 'tenant-95',
      clientId: 'client-95',
      managedTenantId: 'managed-95',
      user: buildUser({
        entraObjectId: 'entra-95',
        userPrincipalName: 'user95@example.com',
        email: 'user95@example.com',
      }),
    });

    expect(result).toMatchObject({
      action: 'linked',
      contactNameId: 'contact-95',
      linkIdentity: {
        entraTenantId: 'entra-tenant',
        entraObjectId: 'entra-95',
      },
    });
    expect(createContactMock).not.toHaveBeenCalled();
    expect(upsertEntraContactLinkActiveMock).toHaveBeenCalled();
    expect(harness.contactsUpdateMock).toHaveBeenCalled();
  });

  it('T096: when no match exists, creates a new contact under mapped client', async () => {
    setupReconcilerKnexHarness();
    findContactMatchesByEmailMock.mockResolvedValue([]);
    createContactMock.mockResolvedValue({ contact_name_id: 'contact-96' });

    const { reconcileEntraUserToContact } = await import(
      '@ee/lib/integrations/entra/sync/contactReconciler'
    );
    const result = await reconcileEntraUserToContact({
      tenantId: 'tenant-96',
      clientId: 'client-96',
      managedTenantId: 'managed-96',
      user: buildUser({
        entraObjectId: 'entra-96',
        userPrincipalName: 'user96@example.com',
        email: 'user96@example.com',
      }),
    });

    expect(result).toMatchObject({
      action: 'created',
      contactNameId: 'contact-96',
    });
    expect(createContactMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'client-96',
        email: 'user96@example.com',
      }),
      'tenant-96',
      expect.anything()
    );
  });

  it('T097: multiple plausible matches queue an ambiguous reconciliation item', async () => {
    setupReconcilerKnexHarness();
    findContactMatchesByEmailMock.mockResolvedValue([
      {
        contactNameId: 'contact-97a',
        clientId: 'client-97',
        email: 'user97@example.com',
        fullName: 'User 97 A',
        isInactive: false,
      },
      {
        contactNameId: 'contact-97b',
        clientId: 'client-97',
        email: 'user97@example.com',
        fullName: 'User 97 B',
        isInactive: false,
      },
    ]);
    queueAmbiguousEntraMatchMock.mockResolvedValue({ queueItemId: 'queue-97' });

    const { reconcileEntraUserToContact } = await import(
      '@ee/lib/integrations/entra/sync/contactReconciler'
    );
    const result = await reconcileEntraUserToContact({
      tenantId: 'tenant-97',
      clientId: 'client-97',
      managedTenantId: 'managed-97',
      user: buildUser({
        entraObjectId: 'entra-97',
        userPrincipalName: 'user97@example.com',
        email: 'user97@example.com',
      }),
    });

    expect(result).toEqual({
      action: 'ambiguous',
      queueItemId: 'queue-97',
    });
    expect(queueAmbiguousEntraMatchMock).toHaveBeenCalled();
    expect(createContactMock).not.toHaveBeenCalled();
  });

  it('T099: linking and create paths persist Entra identity metadata on contacts', async () => {
    const harness = setupReconcilerKnexHarness();
    findContactMatchesByEmailMock.mockResolvedValue([
      {
        contactNameId: 'contact-99',
        clientId: 'client-99',
        email: 'user99@example.com',
        fullName: 'User 99',
        isInactive: false,
      },
    ]);

    const { reconcileEntraUserToContact } = await import(
      '@ee/lib/integrations/entra/sync/contactReconciler'
    );
    await reconcileEntraUserToContact({
      tenantId: 'tenant-99',
      clientId: 'client-99',
      managedTenantId: 'managed-99',
      user: buildUser({
        entraObjectId: 'entra-99',
        userPrincipalName: 'user99@example.com',
        email: 'user99@example.com',
      }),
    });

    expect(harness.contactsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entra_object_id: 'entra-99',
        entra_sync_source: 'entra_sync',
        entra_user_principal_name: 'user99@example.com',
        entra_account_enabled: true,
      })
    );
  });

  it('T106: every processed contact refreshes last_entra_sync_at in linked and created paths', async () => {
    const linkedHarness = setupReconcilerKnexHarness();
    findContactMatchesByEmailMock.mockResolvedValueOnce([
      {
        contactNameId: 'contact-106-linked',
        clientId: 'client-106',
        email: 'user106@example.com',
        fullName: 'User 106 Linked',
        isInactive: false,
      },
    ]);

    const { reconcileEntraUserToContact } = await import(
      '@ee/lib/integrations/entra/sync/contactReconciler'
    );
    await reconcileEntraUserToContact({
      tenantId: 'tenant-106',
      clientId: 'client-106',
      managedTenantId: 'managed-106',
      user: buildUser({
        entraObjectId: 'entra-106-linked',
        userPrincipalName: 'user106@example.com',
        email: 'user106@example.com',
      }),
    });

    const createdHarness = setupReconcilerKnexHarness();
    findContactMatchesByEmailMock.mockResolvedValueOnce([]);
    createContactMock.mockResolvedValueOnce({ contact_name_id: 'contact-106-created' });
    await reconcileEntraUserToContact({
      tenantId: 'tenant-106',
      clientId: 'client-106',
      managedTenantId: 'managed-106',
      user: buildUser({
        entraObjectId: 'entra-106-created',
        userPrincipalName: 'new106@example.com',
        email: 'new106@example.com',
      }),
    });

    expect(linkedHarness.contactsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        last_entra_sync_at: 'db-now',
      })
    );
    expect(createdHarness.contactsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        last_entra_sync_at: 'db-now',
      })
    );
  });
});
