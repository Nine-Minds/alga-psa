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
});
