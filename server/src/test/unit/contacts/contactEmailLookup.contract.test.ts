import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  tenant: 'test-tenant',
  userId: 'test-user',
  trx: undefined as any,
  createTenantKnexMock: vi.fn(),
  withTransactionMock: vi.fn(),
  getContactByEmailMock: vi.fn(),
  createContactMock: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action({ user_id: testState.userId, tenant: testState.tenant }, { tenant: testState.tenant }, ...args),
}));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: testState.createTenantKnexMock,
    withTransaction: testState.withTransactionMock,
  };
});

vi.mock('@alga-psa/shared/models/contactModel', () => ({
  ContactModel: {
    getContactByEmail: testState.getContactByEmailMock,
    createContact: testState.createContactMock,
  },
}));

vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: vi.fn(),
  getClientLogoUrlsBatch: vi.fn(),
  getContactAvatarUrlsBatch: vi.fn(),
}));

vi.mock('../../../../../packages/clients/src/models/interactions', () => ({
  default: {},
}));

vi.mock('../../../../../packages/clients/src/lib/authHelpers', () => ({
  hasPermissionAsync: vi.fn().mockResolvedValue(true),
}));

import {
  createOrFindContactByEmail,
  findContactByEmailAddress,
} from '../../../../../packages/clients/src/actions/queryActions';

type FakeQuery = {
  select: (..._args: any[]) => FakeQuery;
  where: (..._args: any[]) => FakeQuery;
  first: () => Promise<any>;
};

function makeQuery(firstRow: any): FakeQuery {
  return {
    select: () => makeQuery(firstRow),
    where: () => makeQuery(firstRow),
    first: async () => firstRow,
  };
}

describe('contact email lookup query actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.trx = ((table: string) => {
      if (table === 'clients') {
        return makeQuery({ client_name: 'Acme Client' });
      }

      throw new Error(`Unexpected table ${table}`);
    }) as any;
    testState.createTenantKnexMock.mockResolvedValue({ knex: {}, tenant: testState.tenant });
    testState.withTransactionMock.mockImplementation(async (_knexLike: any, callback: (trx: any) => Promise<unknown>) =>
      callback(testState.trx)
    );
  });

  it('T031: findContactByEmailAddress returns a contact when ContactModel resolves an additional-email match', async () => {
    const expectedContact = {
      contact_name_id: 'contact-1',
      email: 'owner@acme.com',
      additional_email_addresses: [
        {
          email_address: 'billing@acme.com',
        },
      ],
    };
    testState.getContactByEmailMock.mockResolvedValue(expectedContact);

    const contact = await findContactByEmailAddress('billing@acme.com');

    expect(testState.getContactByEmailMock).toHaveBeenCalledWith('billing@acme.com', testState.tenant, testState.trx);
    expect(contact).toEqual(expectedContact);
  });

  it('T032: createOrFindContactByEmail creates a new contact with only the primary contacts.email populated when no match exists', async () => {
    testState.getContactByEmailMock.mockResolvedValue(null);
    testState.createContactMock.mockImplementation(async (input: any) => ({
      contact_name_id: 'contact-created',
      ...input,
    }));

    const result = await createOrFindContactByEmail({
      email: 'New.Contact@Acme.com',
      name: 'New Contact',
      clientId: 'client-1',
      phone: '',
      title: 'Coordinator',
    });

    expect(testState.createContactMock).toHaveBeenCalledWith(
      expect.objectContaining({
        full_name: 'New Contact',
        email: 'new.contact@acme.com',
        client_id: 'client-1',
        phone_numbers: [],
        role: 'Coordinator',
        is_inactive: false,
      }),
      testState.tenant,
      testState.trx
    );
    expect(testState.createContactMock.mock.calls[0]?.[0]).not.toHaveProperty('additional_email_addresses');
    expect(result).toMatchObject({
      isNew: true,
      contact: expect.objectContaining({
        email: 'new.contact@acme.com',
        client_name: 'Acme Client',
      }),
    });
  });
});
