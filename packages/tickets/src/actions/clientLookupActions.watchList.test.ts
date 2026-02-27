import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;
const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const getAllActiveContactsModelMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
}));

vi.mock('@alga-psa/shared/ticketClients/clients', () => ({
  getAllClients: vi.fn(),
  getClientById: vi.fn(),
}));

vi.mock('@alga-psa/shared/ticketClients/contacts', () => ({
  getContactByContactNameId: vi.fn(),
  getContactsByClient: vi.fn(),
  getAllActiveContacts: (...args: any[]) => getAllActiveContactsModelMock(...args),
}));

vi.mock('@alga-psa/shared/ticketClients/locations', () => ({
  getClientLocations: vi.fn(),
}));

describe('clientLookupActions watch-list contact lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = { user_id: 'internal-1', user_type: 'internal', tenant: 'tenant-1' };
    createTenantKnexMock.mockResolvedValue({ knex: { any: true } });
  });

  it('T058: all-contact lookup delegates to shared model with full_name sort for active tenant contacts', async () => {
    const trx = { trx: true } as any;
    const contacts = [
      { contact_name_id: 'contact-1', full_name: 'Alpha Contact', email: 'alpha@example.com' },
      { contact_name_id: 'contact-2', full_name: 'Zulu Contact', email: 'zulu@example.com' },
    ] as any[];
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) =>
      callback(trx)
    );
    getAllActiveContactsModelMock.mockResolvedValue(contacts);

    const { getAllActiveContacts } = await import('./clientLookupActions');
    const result = await getAllActiveContacts();

    expect(getAllActiveContactsModelMock).toHaveBeenCalledWith(trx, 'tenant-1', 'asc');
    expect(result).toEqual(contacts);
  });

  it('T059: all-contact lookup keeps active-only default path and allows explicit sort direction override', async () => {
    const trx = { trx: true } as any;
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) =>
      callback(trx)
    );
    getAllActiveContactsModelMock.mockResolvedValue([]);

    const { getAllActiveContacts } = await import('./clientLookupActions');
    await getAllActiveContacts('desc');

    expect(getAllActiveContactsModelMock).toHaveBeenCalledWith(trx, 'tenant-1', 'desc');
  });
});
