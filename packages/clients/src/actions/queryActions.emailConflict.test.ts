import { beforeEach, describe, expect, it, vi } from 'vitest';

const permitsMock = vi.fn();
const resolveOwnershipMock = vi.fn();
const getContactByEmailMock = vi.fn();
const createContactMock = vi.fn();
const hasPermissionMock = vi.fn();
let currentUser: Record<string, unknown>;

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} as any }),
  tenantDb: (conn: any) => ({ table: (table: string) => conn(table) }),
  withTransaction: async (_db: unknown, callback: (trx: unknown) => Promise<unknown>) => callback({}),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(currentUser, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/auth/lib/clientBillingProjection', () => ({
  projectClientForSubject: vi.fn(),
  projectClientsForSubject: vi.fn(),
}));
vi.mock('@alga-psa/authorization/recordCreateAuthorization', () => ({ assertRecordCreateAllowed: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/authorization/clientScopeAuthorization', () => ({
  createClientScopeContext: vi.fn(async () => ({
    permits: (...args: any[]) => permitsMock(...args),
    narrowing: async () => ({ narrowed: false, apply: (query: any) => query }),
  })),
}));
vi.mock('@alga-psa/shared/models/contactEmailOwnership', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  resolveContactEmailOwnership: (...args: any[]) => resolveOwnershipMock(...args),
}));
vi.mock('@alga-psa/shared/models/contactModel', () => ({
  ContactModel: {
    getContactByEmail: (...args: any[]) => getContactByEmailMock(...args),
    createContact: (...args: any[]) => createContactMock(...args),
  },
}));
vi.mock('../lib/authHelpers', () => ({
  hasPermissionAsync: (...args: any[]) => hasPermissionMock(...args),
  hasMspPermission: (...args: any[]) => hasPermissionMock(...args),
  isClientPortalUser: (user: any) => user?.user_type === 'client',
  isMspUser: (user: any) => user?.user_type !== 'client',
}));
vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: vi.fn(),
  getClientLogoUrlsBatch: vi.fn(),
  getContactAvatarUrlsBatch: vi.fn(),
  getEntityImageUrl: vi.fn(),
}));
vi.mock('../lib/contactEvents', () => ({ queueContactCreated: vi.fn() }));

import { createOrFindContactByEmail } from './queryActions';

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

const call = () => (createOrFindContactByEmail as any)({ email: 'Ben@Muscle.ca', clientId: 'client-mine' });

describe('createOrFindContactByEmail: email owned elsewhere', () => {
  beforeEach(() => {
    for (const mock of [permitsMock, resolveOwnershipMock, getContactByEmailMock, createContactMock, hasPermissionMock]) mock.mockReset();
    currentUser = { user_id: 'user-1', user_type: 'internal' };
    hasPermissionMock.mockResolvedValue(true);
    permitsMock.mockResolvedValue(true);
    getContactByEmailMock.mockResolvedValue({ contact_name_id: 'owner-1', client_id: 'client-other' });
    resolveOwnershipMock.mockResolvedValue(owner());
  });

  it('names the contact and client for a caller who can read them (replaces the inline client-name lookup)', async () => {
    await expect(call()).rejects.toThrow('EMAIL_EXISTS: This email address already belongs to Benjamin Dixon at Muscle Corp.');
    expect(resolveOwnershipMock).toHaveBeenCalledWith('tenant-1', 'ben@muscle.ca', expect.anything());
    expect(createContactMock).not.toHaveBeenCalled();
  });

  it('redacts to "another client" when the caller cannot read the owning client', async () => {
    permitsMock.mockImplementation(async (resource: string) => resource !== 'client');

    const error = await call().catch((e: Error) => e);

    expect(error.message).toBe('EMAIL_EXISTS: This email address already belongs to a contact at another client.');
    expect(error.message).not.toMatch(/Benjamin|Muscle/);
  });

  it('a client portal user is never told who owns the address', async () => {
    currentUser = { user_id: 'portal-1', user_type: 'client', clientId: 'client-mine' };

    const error = await call().catch((e: Error) => e);

    expect(error.message).toBe('EMAIL_EXISTS: This email address already belongs to a contact at another client.');
    expect(permitsMock).not.toHaveBeenCalled();
  });

  it('a contact with no client is not named to a portal user either', async () => {
    currentUser = { user_id: 'portal-1', user_type: 'client', clientId: 'client-mine' };
    getContactByEmailMock.mockResolvedValue({ contact_name_id: 'owner-1', client_id: null });
    resolveOwnershipMock.mockResolvedValue(owner({ clientId: null, clientName: null }));

    await expect(call()).rejects.toThrow('EMAIL_EXISTS: This email address already belongs to a contact at another client.');
  });

  it('an additional-email owner is described as such', async () => {
    resolveOwnershipMock.mockResolvedValue(owner({ kind: 'additional' }));

    await expect(call()).rejects.toThrow('EMAIL_EXISTS: This email address is already an additional email address on Benjamin Dixon at Muscle Corp.');
  });

  it('an owner at the same client is returned, not an error', async () => {
    getContactByEmailMock.mockResolvedValue({ contact_name_id: 'owner-1', client_id: 'client-mine', client_name: 'Mine' });

    await expect(call()).resolves.toMatchObject({ isNew: false, contact: { contact_name_id: 'owner-1' } });
    expect(resolveOwnershipMock).not.toHaveBeenCalled();
  });
});
