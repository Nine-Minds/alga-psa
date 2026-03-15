import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  getContactByEmailMock: vi.fn(),
  createContactMock: vi.fn(),
}));

vi.mock('../../models/contactModel', () => ({
  ContactModel: {
    getContactByEmail: testState.getContactByEmailMock,
    createContact: testState.createContactMock,
  },
}));

import { EmailService } from '../emailService';

type FakeKnex = {
  (table: string): {
    select: (..._args: any[]) => {
      where: (..._args: any[]) => {
        first: () => Promise<any>;
      };
    };
  };
};

function makeKnex(clientRow?: any): FakeKnex {
  return ((table: string) => {
    if (table === 'clients') {
      return {
        select: () => ({
          where: () => ({
            first: async () => clientRow,
          }),
        }),
      };
    }

    throw new Error(`Unexpected table ${table}`);
  }) as FakeKnex;
}

describe('EmailService contact lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T033: findContactByEmail preserves both matched sender email and the contact primary email when an additional row matched', async () => {
    testState.getContactByEmailMock.mockResolvedValue({
      contact_name_id: 'contact-1',
      full_name: 'Alice Contact',
      email: 'owner@acme.com',
      client_id: 'client-1',
      role: 'Coordinator',
      default_phone_number: null,
      phone_numbers: [
        {
          is_default: true,
          phone_number: '555-1111',
        },
      ],
    });

    const service = new EmailService(makeKnex({ client_name: 'Acme Client' }) as any, 'tenant-1');

    const result = await service.findContactByEmail('billing@acme.com');

    expect(testState.getContactByEmailMock).toHaveBeenCalledWith('billing@acme.com', 'tenant-1', expect.any(Function));
    expect(result).toEqual({
      contact_id: 'contact-1',
      name: 'Alice Contact',
      email: 'owner@acme.com',
      matched_email: 'billing@acme.com',
      client_id: 'client-1',
      client_name: 'Acme Client',
      phone: '555-1111',
      title: 'Coordinator',
    });
  });

  it('T034: createOrFindContact creates a new contact with only the primary email in contacts.email when no match exists', async () => {
    testState.getContactByEmailMock.mockResolvedValue(null);
    testState.createContactMock.mockResolvedValue({
      contact_name_id: 'contact-created',
      full_name: 'New Contact',
      email: 'new.contact@acme.com',
      client_id: 'client-1',
      role: 'Coordinator',
      created_at: '2026-03-15T00:00:00.000Z',
      default_phone_number: null,
      phone_numbers: [],
    });

    const service = new EmailService(makeKnex() as any, 'tenant-1');

    const result = await service.createOrFindContact({
      email: 'New.Contact@Acme.com',
      name: 'New Contact',
      client_id: 'client-1',
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
      }),
      'tenant-1',
      expect.any(Function)
    );
    expect(testState.createContactMock.mock.calls[0]?.[0]).not.toHaveProperty('additional_email_addresses');
    expect(result).toEqual({
      id: 'contact-created',
      name: 'New Contact',
      email: 'new.contact@acme.com',
      client_id: 'client-1',
      phone: undefined,
      title: 'Coordinator',
      created_at: '2026-03-15T00:00:00.000Z',
      is_new: true,
    });
  });
});
