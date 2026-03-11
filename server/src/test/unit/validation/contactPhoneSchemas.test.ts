import { describe, expect, it } from 'vitest';

import {
  contactResponseSchema,
  createContactSchema,
  updateContactSchema,
} from '../../../lib/api/schemas/contact';

describe('contact phone API schemas', () => {
  it('T030: create/update schemas accept phone_numbers and no longer accept scalar phone_number', () => {
    const validCreate = createContactSchema.safeParse({
      full_name: 'Jane Doe',
      email: 'jane@example.com',
      phone_numbers: [{
        phone_number: '555-0100',
        canonical_type: 'work',
        is_default: true,
        display_order: 0,
      }],
    });

    expect(validCreate.success).toBe(true);

    const invalidLegacyCreate = createContactSchema.safeParse({
      full_name: 'Jane Doe',
      email: 'jane@example.com',
      phone_number: '555-0100',
    });

    expect(invalidLegacyCreate.success).toBe(false);

    const validUpdate = updateContactSchema.safeParse({
      phone_numbers: [{
        phone_number: '555-0101',
        custom_type: 'Desk Line',
        is_default: true,
        display_order: 0,
      }],
    });

    expect(validUpdate.success).toBe(true);
  });

  it('T015/T030: contact response schema accepts ordered normalized phone rows and derived defaults', () => {
    const parsed = contactResponseSchema.safeParse({
      contact_name_id: '11111111-1111-4111-8111-111111111111',
      full_name: 'Jane Doe',
      client_id: null,
      phone_numbers: [
        {
          contact_phone_number_id: '22222222-2222-4222-8222-222222222222',
          phone_number: '555-0100',
          normalized_phone_number: '5550100',
          canonical_type: 'work',
          custom_type: null,
          is_default: false,
          display_order: 0,
        },
        {
          contact_phone_number_id: '33333333-3333-4333-8333-333333333333',
          phone_number: '555-0101',
          normalized_phone_number: '5550101',
          canonical_type: 'mobile',
          custom_type: null,
          is_default: true,
          display_order: 1,
        },
      ],
      default_phone_number: '555-0101',
      default_phone_type: 'mobile',
      email: 'jane@example.com',
      role: null,
      created_at: '2026-03-09T00:00:00.000Z',
      updated_at: '2026-03-09T00:00:00.000Z',
      is_inactive: false,
      notes: null,
      tenant: '44444444-4444-4444-8444-444444444444',
    });

    expect(parsed.success).toBe(true);
  });
});
