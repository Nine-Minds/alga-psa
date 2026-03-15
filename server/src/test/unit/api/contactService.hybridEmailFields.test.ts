import { beforeEach, describe, expect, it, vi } from 'vitest';

const createContactMock = vi.fn();
const getContactByIdMock = vi.fn();
const updateContactMock = vi.fn();
const withTransactionMock = vi.fn(async (_knex: unknown, callback: (trx: any) => Promise<any>) =>
  callback({ transactionId: 'trx-1' })
);

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    withTransaction: (...args: any[]) => withTransactionMock(...args),
  };
});

vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getContactAvatarUrl: vi.fn().mockResolvedValue(null),
}));

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@alga-psa/shared/workflow/streams/domainEventBuilders/contactEventBuilders', () => ({
  buildContactCreatedPayload: vi.fn(() => ({ event: 'created' })),
  buildContactUpdatedPayload: vi.fn(() => ({
    updatedFields: ['primary_email_type', 'additional_email_addresses'],
    changes: { primary_email_type: { before: 'work', after: 'Escalations' } },
  })),
  buildContactArchivedPayload: vi.fn(() => ({ event: 'archived' })),
}));

vi.mock('@alga-psa/shared/models/contactModel', () => ({
  ContactModel: {
    createContact: (...args: any[]) => createContactMock(...args),
    getContactById: (...args: any[]) => getContactByIdMock(...args),
    updateContact: (...args: any[]) => updateContactMock(...args),
    hydrateContactsWithPhoneNumbers: vi.fn(),
  },
}));

describe('ContactService hybrid email field forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T040: ContactService forwards primary email label metadata and additional email rows on create and update', async () => {
    const { ContactService } = await import('../../../lib/api/services/ContactService');

    const service = new ContactService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {}, tenant: 'tenant-1' });

    createContactMock.mockResolvedValue({
      contact_name_id: '11111111-1111-4111-8111-111111111111',
    });
    getContactByIdMock
      .mockResolvedValueOnce({
        contact_name_id: '11111111-1111-4111-8111-111111111111',
        client_id: '22222222-2222-4222-8222-222222222222',
        full_name: 'API Contact',
        email: 'primary@example.com',
        primary_email_canonical_type: 'work',
        primary_email_type: 'work',
        additional_email_addresses: [
          {
            contact_additional_email_address_id: '33333333-3333-4333-8333-333333333333',
            email_address: 'billing@example.com',
            normalized_email_address: 'billing@example.com',
            canonical_type: 'billing',
            custom_type: null,
            display_order: 0,
          },
        ],
        phone_numbers: [],
        is_inactive: false,
        created_at: '2026-03-15T00:00:00.000Z',
        updated_at: '2026-03-15T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        contact_name_id: '11111111-1111-4111-8111-111111111111',
        client_id: '22222222-2222-4222-8222-222222222222',
        full_name: 'API Contact',
        email: 'primary@example.com',
        primary_email_canonical_type: 'work',
        primary_email_type: 'work',
        additional_email_addresses: [],
        phone_numbers: [],
        is_inactive: false,
        created_at: '2026-03-15T00:00:00.000Z',
        updated_at: '2026-03-15T00:00:00.000Z',
      });
    updateContactMock.mockResolvedValue({
      contact_name_id: '11111111-1111-4111-8111-111111111111',
      client_id: '22222222-2222-4222-8222-222222222222',
      full_name: 'API Contact',
      email: 'primary@example.com',
      primary_email_canonical_type: null,
      primary_email_type: 'Escalations',
      additional_email_addresses: [
        {
          contact_additional_email_address_id: '33333333-3333-4333-8333-333333333333',
          email_address: 'billing@example.com',
          normalized_email_address: 'billing@example.com',
          canonical_type: 'billing',
          custom_type: null,
          display_order: 0,
        },
        {
          contact_additional_email_address_id: '44444444-4444-4444-8444-444444444444',
          email_address: 'afterhours@example.com',
          normalized_email_address: 'afterhours@example.com',
          canonical_type: null,
          custom_type: 'After Hours',
          display_order: 1,
        },
      ],
      phone_numbers: [],
      is_inactive: false,
      created_at: '2026-03-15T00:00:00.000Z',
      updated_at: '2026-03-15T01:00:00.000Z',
    });

    await service.create({
      full_name: 'API Contact',
      email: 'primary@example.com',
      client_id: '22222222-2222-4222-8222-222222222222',
      primary_email_canonical_type: 'work',
      additional_email_addresses: [
        {
          email_address: 'billing@example.com',
          canonical_type: 'billing',
          display_order: 0,
        },
      ],
      phone_numbers: [],
    } as any, {
      tenant: 'tenant-1',
      userId: 'user-1',
    });

    expect(createContactMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'primary@example.com',
        primary_email_canonical_type: 'work',
        additional_email_addresses: [
          expect.objectContaining({
            email_address: 'billing@example.com',
            canonical_type: 'billing',
          }),
        ],
      }),
      'tenant-1',
      expect.anything()
    );

    const updated = await service.update('11111111-1111-4111-8111-111111111111', {
      primary_email_canonical_type: null,
      primary_email_custom_type: 'Escalations',
      additional_email_addresses: [
        {
          email_address: 'billing@example.com',
          canonical_type: 'billing',
          display_order: 0,
        },
        {
          email_address: 'afterhours@example.com',
          custom_type: 'After Hours',
          display_order: 1,
        },
      ],
    } as any, {
      tenant: 'tenant-1',
      userId: 'user-1',
    });

    expect(updateContactMock).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({
        primary_email_canonical_type: null,
        primary_email_custom_type: 'Escalations',
        additional_email_addresses: [
          expect.objectContaining({
            email_address: 'billing@example.com',
            canonical_type: 'billing',
          }),
          expect.objectContaining({
            email_address: 'afterhours@example.com',
            custom_type: 'After Hours',
          }),
        ],
      }),
      'tenant-1',
      expect.anything()
    );
    expect(updated.primary_email_type).toBe('Escalations');
    expect(updated.additional_email_addresses).toHaveLength(2);
  });
});
