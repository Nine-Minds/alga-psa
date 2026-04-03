import { describe, expect, it } from 'vitest';

import { ContactModel } from '../contactModel';

describe('ContactModel phone validation', () => {
  it('accepts blank optional role and notes after nullable field cleanup', () => {
    const validation = ContactModel.validateCreateContactInput({
      full_name: 'Jane Doe',
      email: 'jane@example.com',
      role: '',
      notes: '',
      phone_numbers: [
        {
          phone_number: '555-0100',
          canonical_type: 'work',
          is_default: true,
          display_order: 0,
        },
      ],
    });

    expect(validation.valid).toBe(true);
    expect(validation.data).toEqual(expect.objectContaining({
      role: null,
      notes: null,
    }));
  });

  it('T008: rejects phone collections with multiple default rows', () => {
    const validation = ContactModel.validateCreateContactInput({
      full_name: 'Jane Doe',
      email: 'jane@example.com',
      phone_numbers: [
        {
          phone_number: '555-0100',
          canonical_type: 'work',
          is_default: true,
          display_order: 0,
        },
        {
          phone_number: '555-0101',
          canonical_type: 'mobile',
          is_default: true,
          display_order: 1,
        },
      ],
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors?.[0]).toContain('Only one phone number can be marked as default');
  });

  it('T009: rejects phone collections with numbers present but no default row selected', () => {
    const validation = ContactModel.validateCreateContactInput({
      full_name: 'Jane Doe',
      email: 'jane@example.com',
      phone_numbers: [
        {
          phone_number: '555-0100',
          canonical_type: 'work',
          is_default: false,
          display_order: 0,
        },
      ],
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors?.[0]).toContain('Exactly one default phone number is required');
  });

  it('T010: accepts canonical phone rows and one custom-type row in the same payload', () => {
    const validation = ContactModel.validateCreateContactInput({
      full_name: 'Jane Doe',
      email: 'jane@example.com',
      phone_numbers: [
        {
          phone_number: '555-0100',
          canonical_type: 'work',
          is_default: true,
          display_order: 0,
        },
        {
          phone_number: '555-0101',
          custom_type: 'Desk Line',
          is_default: false,
          display_order: 1,
        },
      ],
    });

    expect(validation.valid).toBe(true);
    expect(validation.data?.phone_numbers).toEqual([
      expect.objectContaining({
        phone_number: '555-0100',
        canonical_type: 'work',
        custom_type: null,
        is_default: true,
        display_order: 0,
      }),
      expect.objectContaining({
        phone_number: '555-0101',
        canonical_type: null,
        custom_type: 'Desk Line',
        normalized_custom_type: 'desk line',
        is_default: false,
        display_order: 1,
      }),
    ]);
  });

  it('T008: accepts a labeled primary email and no additional email rows', () => {
    const validation = ContactModel.validateCreateContactInput({
      full_name: 'Jane Doe',
      email: 'jane.primary@example.com',
      primary_email_canonical_type: 'billing',
    });

    expect(validation.valid).toBe(true);
    expect(validation.data).toEqual(expect.objectContaining({
      primary_email_canonical_type: 'billing',
      primary_email_custom_type_id: null,
      additional_email_addresses: [],
    }));
  });

  it('T009: rejects an additional email row that matches the primary email', () => {
    const validation = ContactModel.validateCreateContactInput({
      full_name: 'Jane Doe',
      email: 'jane.primary@example.com',
      additional_email_addresses: [
        {
          email_address: 'JANE.PRIMARY@EXAMPLE.COM',
          canonical_type: 'work',
          display_order: 0,
        },
      ],
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors?.[0]).toContain('Additional email address cannot match primary email');
  });

  it('T010: rejects duplicate additional email rows in a single payload', () => {
    const validation = ContactModel.validateCreateContactInput({
      full_name: 'Jane Doe',
      email: 'jane.primary@example.com',
      additional_email_addresses: [
        {
          email_address: 'jane.alt@example.com',
          canonical_type: 'work',
          display_order: 0,
        },
        {
          email_address: 'JANE.ALT@example.com',
          custom_type: 'Desk Line',
          display_order: 1,
        },
      ],
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors?.[0]).toContain('Duplicate additional email address is not allowed');
  });

  it('T011: rejects malformed additional email rows and invalid label combinations', () => {
    const malformedEmail = ContactModel.validateCreateContactInput({
      full_name: 'Jane Doe',
      email: 'jane.primary@example.com',
      additional_email_addresses: [
        {
          email_address: 'not-an-email',
          canonical_type: 'work',
          display_order: 0,
        },
        {
          email_address: 'jane.other2@example.com',
          canonical_type: 'billing',
          custom_type: 'Work',
          display_order: 1,
        },
      ],
    });

    const missingType = ContactModel.validateCreateContactInput({
      full_name: 'Jane Doe',
      email: 'jane.primary2@example.com',
      additional_email_addresses: [
        {
          email_address: 'jane.other@example.com',
          display_order: 0,
        },
      ],
    });

    const invalidPrimaryType = ContactModel.validateCreateContactInput({
      full_name: 'Jane Doe',
      email: 'jane.primary3@example.com',
      primary_email_canonical_type: 'billing',
      primary_email_custom_type: 'Escalations',
    });

    expect(malformedEmail.valid).toBe(false);
    expect(malformedEmail.errors?.some((error) => error.includes('Invalid email address'))).toBe(true);
    expect(malformedEmail.errors?.some((error) => error.includes('custom_type'))).toBe(true);

    expect(missingType.valid).toBe(false);
    expect(missingType.errors?.some((error) => error.includes('Choose a canonical type or provide a custom type'))).toBe(true);

    expect(invalidPrimaryType.valid).toBe(false);
    expect(invalidPrimaryType.errors?.some((error) => error.includes('custom primary email type'))).toBe(true);
  });
});
