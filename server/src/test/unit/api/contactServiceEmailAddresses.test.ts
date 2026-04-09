import { beforeEach, describe, expect, it, vi } from 'vitest';

const withTransactionMock = vi.fn();
const createContactMock = vi.fn();
const getContactByIdMock = vi.fn();
const publishWorkflowEventMock = vi.fn();

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    withTransaction: (...args: any[]) => withTransactionMock(...args),
  };
});

vi.mock('@alga-psa/shared/models/contactModel', () => ({
  ContactModel: {
    createContact: (...args: any[]) => createContactMock(...args),
    getContactById: (...args: any[]) => getContactByIdMock(...args),
  },
}));

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishWorkflowEvent: (...args: any[]) => publishWorkflowEventMock(...args),
}));

describe('ContactService hybrid email API create path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withTransactionMock.mockImplementation(async (_knex: unknown, callback: (trx: any) => Promise<any>) =>
      callback({})
    );
    createContactMock.mockResolvedValue({
      contact_name_id: '11111111-1111-4111-8111-111111111111',
    });
    getContactByIdMock.mockResolvedValue({
      contact_name_id: '11111111-1111-4111-8111-111111111111',
      full_name: 'Jane Doe',
      client_id: '22222222-2222-4222-8222-222222222222',
      phone_numbers: [],
      email: 'jane@example.com',
      primary_email_canonical_type: 'billing',
      primary_email_custom_type_id: null,
      primary_email_type: 'billing',
      additional_email_addresses: [
        {
          contact_additional_email_address_id: '33333333-3333-4333-8333-333333333333',
          email_address: 'jane.personal@example.com',
          normalized_email_address: 'jane.personal@example.com',
          canonical_type: 'personal',
          custom_type: null,
          display_order: 0,
        },
      ],
      role: null,
      notes: null,
      is_inactive: false,
      created_at: '2026-03-15T00:00:00.000Z',
      updated_at: '2026-03-15T00:00:00.000Z',
      tenant: '44444444-4444-4444-8444-444444444444',
    });
    publishWorkflowEventMock.mockResolvedValue(undefined);
  });

  it('T040: ContactService.createContact forwards primary email label metadata and additional email rows to ContactModel', async () => {
    const { ContactService } = await import('../../../lib/api/services/ContactService');
    const service = new ContactService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {} });

    const result = await service.createContact(
      {
        full_name: 'Jane Doe',
        email: 'jane@example.com',
        client_id: '22222222-2222-4222-8222-222222222222',
        primary_email_canonical_type: 'billing',
        additional_email_addresses: [
          {
            email_address: 'jane.personal@example.com',
            canonical_type: 'personal',
            display_order: 0,
          },
        ],
      },
      {
        tenant: '44444444-4444-4444-8444-444444444444',
        userId: '55555555-5555-4555-8555-555555555555',
      } as any
    );

    expect(createContactMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'jane@example.com',
        primary_email_canonical_type: 'billing',
        additional_email_addresses: [
          expect.objectContaining({
            email_address: 'jane.personal@example.com',
            canonical_type: 'personal',
            display_order: 0,
          }),
        ],
      }),
      '44444444-4444-4444-8444-444444444444',
      {}
    );
    expect(result).toMatchObject({
      email: 'jane@example.com',
      primary_email_type: 'billing',
      additional_email_addresses: [
        expect.objectContaining({
          email_address: 'jane.personal@example.com',
        }),
      ],
    });
  });
});
