import type { CreateContactInput, IContact } from '@alga-psa/types';
import { describe, expectTypeOf, it } from 'vitest';

describe('contact phone type exports', () => {
  it('T007: accepts normalized phone collections and rejects legacy scalar-only payloads', () => {
    const createInput: CreateContactInput = {
      full_name: 'Jane Doe',
      email: 'jane@example.com',
      phone_numbers: [{
        phone_number: '555-0100',
        canonical_type: 'work',
        is_default: true,
        display_order: 0,
      }],
    };

    expectTypeOf(createInput.phone_numbers).toEqualTypeOf<CreateContactInput['phone_numbers']>();

    const contact: IContact = {
      contact_name_id: '11111111-1111-4111-8111-111111111111',
      tenant: '22222222-2222-4222-8222-222222222222',
      full_name: 'Jane Doe',
      client_id: null,
      phone_numbers: [{
        contact_phone_number_id: '33333333-3333-4333-8333-333333333333',
        phone_number: '555-0100',
        normalized_phone_number: '5550100',
        canonical_type: 'work',
        custom_type: null,
        is_default: true,
        display_order: 0,
      }],
      default_phone_number: '555-0100',
      default_phone_type: 'work',
      email: 'jane@example.com',
      role: null,
      notes: null,
      is_inactive: false,
      created_at: '2026-03-09T00:00:00.000Z',
      updated_at: '2026-03-09T00:00:00.000Z',
    };

    expectTypeOf(contact.phone_numbers[0].phone_number).toEqualTypeOf<string>();

    // @ts-expect-error legacy scalar phone payloads are no longer part of the contact create contract
    const legacyCreateInput: CreateContactInput = {
      full_name: 'Legacy Contact',
      phone_number: '555-0101',
    };

    expectTypeOf(legacyCreateInput).toMatchTypeOf<CreateContactInput>();
  });
});
