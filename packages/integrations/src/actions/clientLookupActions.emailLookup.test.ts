import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.fn();
const getContactByEmailMock = vi.fn();
const createContactMock = vi.fn();
const createDefaultTaxSettingsMock = vi.fn();
const publishWorkflowEventMock = vi.fn();

const clientFirstMock = vi.fn();
const clientWhereMock = vi.fn(() => ({
  first: clientFirstMock,
}));
const clientSelectMock = vi.fn(() => ({
  where: clientWhereMock,
}));
const trxMock = vi.fn((table: string) => {
  if (table === 'clients') {
    return {
      select: clientSelectMock,
    };
  }

  throw new Error(`Unexpected table lookup in test: ${table}`);
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  withTransaction: async (knex: any, callback: any) => callback(knex),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => async (...args: any[]) => fn({ user_id: 'user-1' }, { tenant: 'tenant-123' }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/shared/models/contactModel', () => ({
  ContactModel: {
    getContactByEmail: getContactByEmailMock,
    createContact: createContactMock,
  },
}));

vi.mock('@alga-psa/shared/billingClients', () => ({
  createDefaultTaxSettings: createDefaultTaxSettingsMock,
}));

vi.mock('@alga-psa/shared/workflow/streams/domainEventBuilders/clientEventBuilders', () => ({
  buildClientCreatedPayload: vi.fn(() => ({})),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: publishWorkflowEventMock,
}));

describe('integration contact email lookup helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    createTenantKnexMock.mockReset();
    getContactByEmailMock.mockReset();
    createContactMock.mockReset();
    createDefaultTaxSettingsMock.mockReset();
    publishWorkflowEventMock.mockReset();
    clientFirstMock.mockReset();
    clientWhereMock.mockClear();
    clientSelectMock.mockClear();
    trxMock.mockClear();

    createTenantKnexMock.mockResolvedValue({ knex: trxMock });
    clientFirstMock.mockResolvedValue({ client_name: 'Acme Corp' });
  });

  it('T043: findIntegrationContactByEmailAddress resolves a contact through an additional email row', async () => {
    getContactByEmailMock.mockResolvedValue({
      contact_name_id: 'contact-1',
      full_name: 'Ada Lovelace',
      email: 'ada@example.com',
      client_id: 'client-1',
      role: 'Engineer',
      default_phone_number: '555-0100',
      phone_numbers: [{ is_default: true, phone_number: '555-0100' }],
      additional_email_addresses: [
        {
          contact_additional_email_address_id: 'additional-1',
          email_address: 'ada.personal@example.com',
          display_order: 0,
        },
      ],
    });

    const { findIntegrationContactByEmailAddress } = await import('./clientLookupActions');
    const contact = await findIntegrationContactByEmailAddress('Ada.Personal@Example.com');

    expect(getContactByEmailMock).toHaveBeenCalledWith(
      'Ada.Personal@Example.com',
      'tenant-123',
      trxMock,
    );
    expect(contact).toMatchObject({
      contact_name_id: 'contact-1',
      email: 'ada@example.com',
      client_name: 'Acme Corp',
    });
  });

  it('returns the existing contact instead of creating a duplicate when create-or-find matches an additional email', async () => {
    getContactByEmailMock.mockResolvedValue({
      contact_name_id: 'contact-1',
      full_name: 'Ada Lovelace',
      email: 'ada@example.com',
      client_id: 'client-1',
      role: 'Engineer',
      default_phone_number: '555-0100',
      phone_numbers: [{ is_default: true, phone_number: '555-0100' }],
      additional_email_addresses: [
        {
          contact_additional_email_address_id: 'additional-1',
          email_address: 'ada.personal@example.com',
          display_order: 0,
        },
      ],
    });

    const { createOrFindIntegrationContactByEmail } = await import('./clientLookupActions');
    const result = await createOrFindIntegrationContactByEmail({
      email: 'ada.personal@example.com',
      clientId: 'client-1',
    });

    expect(result).toMatchObject({
      isNew: false,
      contact: {
        contact_name_id: 'contact-1',
        email: 'ada@example.com',
        client_name: 'Acme Corp',
      },
    });
    expect(createContactMock).not.toHaveBeenCalled();
  });

  it('integration email actions inherit additional-email lookup support through the client lookup helper', async () => {
    getContactByEmailMock.mockResolvedValue({
      contact_name_id: 'contact-1',
      full_name: 'Ada Lovelace',
      email: 'ada@example.com',
      client_id: 'client-1',
      role: 'Engineer',
      default_phone_number: '555-0100',
      phone_numbers: [{ is_default: true, phone_number: '555-0100' }],
      additional_email_addresses: [
        {
          contact_additional_email_address_id: 'additional-1',
          email_address: 'ada.personal@example.com',
          display_order: 0,
        },
      ],
    });

    const { findContactByEmail } = await import('./email-actions/emailActions');
    const result = await findContactByEmail('ada.personal@example.com');

    expect(result).toMatchObject({
      contact_id: 'contact-1',
      email: 'ada@example.com',
      client_name: 'Acme Corp',
      phone: '555-0100',
    });
  });
});
