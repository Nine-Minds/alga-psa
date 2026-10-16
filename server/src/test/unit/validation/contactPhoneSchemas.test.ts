import { describe, expect, it } from 'vitest';
import type { IContactPhoneNumber } from '@alga-psa/shared/interfaces/contact.interfaces';

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

  it('T040: create/update schemas accept primary email label metadata and additional email rows', () => {
    const validCreate = createContactSchema.safeParse({
      full_name: 'Jane Doe',
      email: 'jane@example.com',
      primary_email_canonical_type: 'work',
      additional_email_addresses: [
        {
          email_address: 'billing@example.com',
          canonical_type: 'billing',
          display_order: 0,
        },
      ],
    });

    expect(validCreate.success).toBe(true);

    const validUpdate = updateContactSchema.safeParse({
      primary_email_canonical_type: null,
      primary_email_custom_type: 'Escalations',
      additional_email_addresses: [
        {
          email_address: 'afterhours@example.com',
          custom_type: 'After Hours',
          display_order: 0,
        },
      ],
    });

    expect(validUpdate.success).toBe(true);
  });

  it('T015/T030/T041: contact response schema accepts ordered normalized phone rows plus hybrid email metadata', () => {
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
      primary_email_canonical_type: null,
      primary_email_custom_type_id: '55555555-5555-4555-8555-555555555555',
      primary_email_type: 'Escalations',
      additional_email_addresses: [
        {
          contact_additional_email_address_id: '66666666-6666-4666-8666-666666666666',
          email_address: 'billing@example.com',
          normalized_email_address: 'billing@example.com',
          canonical_type: 'billing',
          custom_type: null,
          display_order: 0,
        },
        {
          contact_additional_email_address_id: '77777777-7777-4777-8777-777777777777',
          email_address: 'alerts@example.com',
          normalized_email_address: 'alerts@example.com',
          canonical_type: null,
          custom_email_type_id: '88888888-8888-4888-8888-888888888888',
          custom_type: 'Alerts',
          display_order: 1,
        },
      ],
      role: null,
      created_at: '2026-03-09T00:00:00.000Z',
      updated_at: '2026-03-09T00:00:00.000Z',
      is_inactive: false,
      notes: null,
      tenant: '44444444-4444-4444-8444-444444444444',
    });

    expect(parsed.success).toBe(true);
  });

  describe('phone row strictness', () => {
    const base = { full_name: 'Jane Doe', email: 'jane@example.com' };

    it('rejects an unrecognized key such as type at phone_numbers.0', () => {
      const result = createContactSchema.safeParse({
        ...base,
        phone_numbers: [{ phone_number: '555-0100', type: 'work', is_default: true }],
      });
      expect(result.success).toBe(false);
      const issue = result.error?.issues.find(i => i.code === 'unrecognized_keys');
      expect(issue?.path).toEqual(['phone_numbers', 0]);
    });

    it('accepts canonical_type work with is_default', () => {
      const result = createContactSchema.safeParse({
        ...base,
        phone_numbers: [{ phone_number: '555-0100', canonical_type: 'work', is_default: true }],
      });
      expect(result.success).toBe(true);
    });

    it('accepts read-only response keys so a GET row can be sent back', () => {
      const result = createContactSchema.safeParse({
        ...base,
        phone_numbers: [{
          contact_phone_number_id: '00000000-0000-4000-8000-000000000001',
          phone_number: '555-0100',
          canonical_type: 'work',
          is_default: true,
          normalized_phone_number: '5550100',
          custom_phone_type_id: null,
        }],
      });
      expect(result.success).toBe(true);
    });
  });

    it('accepts a full hydrated GET row (every key ContactModel hydration emits) for round-trip PUT', () => {
      const hydratedRow = {
        contact_phone_number_id: '00000000-0000-4000-8000-000000000001',
        phone_number: '555-0100',
        extension: null,
        normalized_phone_number: '5550100',
        canonical_type: 'work',
        custom_phone_type_id: null,
        custom_type: null,
        is_default: true,
        display_order: 0,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      } satisfies Required<IContactPhoneNumber>;

      expect(updateContactSchema.safeParse({ phone_numbers: [hydratedRow] }).success).toBe(true);
      expect(updateContactSchema.safeParse({
        phone_numbers: [{ ...hydratedRow, created_at: new Date(), updated_at: new Date() }],
      }).success).toBe(true);
    });
});
