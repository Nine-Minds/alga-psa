import { describe, expect, it } from 'vitest';

import {
  contactResponseSchema,
  createContactSchema,
  updateContactSchema,
} from '../../../lib/api/schemas/contact';

describe('contact email API schemas', () => {
  it('T040: create/update schemas accept primary email label metadata and additional email rows', () => {
    const validCreate = createContactSchema.safeParse({
      full_name: 'Jane Doe',
      email: 'jane@example.com',
      primary_email_canonical_type: 'billing',
      additional_email_addresses: [
        {
          email_address: 'jane.personal@example.com',
          canonical_type: 'personal',
          display_order: 0,
        },
      ],
    });

    expect(validCreate.success).toBe(true);

    const validUpdate = updateContactSchema.safeParse({
      primary_email_custom_type: 'Escalations',
      additional_email_addresses: [
        {
          contact_additional_email_address_id: '11111111-1111-4111-8111-111111111111',
          email_address: 'jane.billing@example.com',
          custom_type: 'Billing Alias',
          display_order: 1,
        },
      ],
    });

    expect(validUpdate.success).toBe(true);
  });

  it('T041: contact response schema accepts primary email metadata plus additional email rows', () => {
    const parsed = contactResponseSchema.safeParse({
      contact_name_id: '11111111-1111-4111-8111-111111111111',
      full_name: 'Jane Doe',
      client_id: null,
      phone_numbers: [],
      email: 'jane@example.com',
      primary_email_canonical_type: 'billing',
      primary_email_custom_type_id: null,
      primary_email_type: 'billing',
      additional_email_addresses: [
        {
          contact_additional_email_address_id: '22222222-2222-4222-8222-222222222222',
          email_address: 'jane.personal@example.com',
          normalized_email_address: 'jane.personal@example.com',
          canonical_type: 'personal',
          custom_type: null,
          display_order: 0,
        },
      ],
      role: null,
      created_at: '2026-03-15T00:00:00.000Z',
      updated_at: '2026-03-15T00:00:00.000Z',
      is_inactive: false,
      notes: null,
      tenant: '33333333-3333-4333-8333-333333333333',
    });

    expect(parsed.success).toBe(true);
  });

  describe('additional email row strictness', () => {
    const base = { full_name: 'Jane Doe', email: 'jane@example.com' };

    it('rejects an unrecognized key such as type at additional_email_addresses.0', () => {
      const result = createContactSchema.safeParse({
        ...base,
        additional_email_addresses: [{ email_address: 'jd@example.com', type: 'work' }],
      });
      expect(result.success).toBe(false);
      const issue = result.error?.issues.find(i => i.code === 'unrecognized_keys');
      expect(issue?.path).toEqual(['additional_email_addresses', 0]);
    });

    it('accepts a canonical_type row and read-only response keys', () => {
      const result = createContactSchema.safeParse({
        ...base,
        additional_email_addresses: [{
          email_address: 'jd@example.com',
          canonical_type: 'work',
          normalized_email_address: 'jd@example.com',
          custom_email_type_id: null,
        }],
      });
      expect(result.success).toBe(true);
    });
  });
});
