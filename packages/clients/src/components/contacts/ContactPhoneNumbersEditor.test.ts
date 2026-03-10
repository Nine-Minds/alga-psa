import { describe, expect, it } from 'vitest';

import {
  compactContactPhoneNumbers,
  moveContactPhoneRows,
  normalizeDraftContactPhoneNumbers,
  validateContactPhoneNumbers,
} from './ContactPhoneNumbersEditor';

describe('ContactPhoneNumbersEditor helpers', () => {
  it('preserves custom draft rows during edit normalization', () => {
    const rows = normalizeDraftContactPhoneNumbers([
      {
        phone_number: '+1 555-246-8135',
        canonical_type: 'work',
        custom_type: null,
        is_default: true,
      },
      {
        phone_number: '',
        canonical_type: null,
        custom_type: '',
        is_default: false,
      },
    ]);

    expect(rows).toEqual([
      {
        phone_number: '+1 555-246-8135',
        canonical_type: 'work',
        custom_type: null,
        is_default: true,
        display_order: 0,
        contact_phone_number_id: undefined,
      },
      {
        phone_number: '',
        canonical_type: null,
        custom_type: '',
        is_default: false,
        display_order: 1,
        contact_phone_number_id: undefined,
      },
    ]);
  });

  it('compacts draft rows before submission', () => {
    const rows = compactContactPhoneNumbers([
      {
        phone_number: '+1 555-246-8135',
        canonical_type: 'work',
        custom_type: null,
        is_default: true,
      },
      {
        phone_number: '',
        canonical_type: null,
        custom_type: '',
        is_default: false,
      },
      {
        phone_number: '+1 646-555-1212 ext. 7',
        canonical_type: null,
        custom_type: 'After Hours',
        is_default: false,
      },
    ]);

    expect(rows).toEqual([
      {
        phone_number: '+1 555-246-8135',
        canonical_type: 'work',
        custom_type: null,
        is_default: true,
        display_order: 0,
        contact_phone_number_id: undefined,
      },
      {
        phone_number: '+1 646-555-1212 ext. 7',
        canonical_type: null,
        custom_type: 'After Hours',
        is_default: false,
        display_order: 1,
        contact_phone_number_id: undefined,
      },
    ]);
  });

  it('validates blank custom rows as incomplete instead of silently accepting them', () => {
    expect(
      validateContactPhoneNumbers([
        {
          phone_number: '+1 555-246-8135',
          canonical_type: 'work',
          custom_type: null,
          is_default: true,
        },
        {
          phone_number: '+1 646-555-1212',
          canonical_type: null,
          custom_type: '',
          is_default: false,
        },
      ])
    ).toContain('Phone 2: Enter a custom phone type.');
  });

  it('preserves moved row data when reordering draft rows', () => {
    const movedRows = moveContactPhoneRows(
      [
        {
          phone_number: '+1 555-246-8135',
          canonical_type: 'work',
          custom_type: null,
          is_default: true,
          display_order: 0,
          _localId: 'row-1',
        },
        {
          phone_number: '+1 646-555-1212 ext. 7',
          canonical_type: 'mobile',
          custom_type: null,
          is_default: false,
          display_order: 1,
          _localId: 'row-2',
        },
      ],
      1,
      -1
    );

    expect(movedRows[0]).toMatchObject({
      phone_number: '+1 646-555-1212 ext. 7',
      canonical_type: 'mobile',
      _localId: 'row-2',
      display_order: 0,
    });
    expect(movedRows[1]).toMatchObject({
      phone_number: '+1 555-246-8135',
      canonical_type: 'work',
      _localId: 'row-1',
      display_order: 1,
    });
  });
});
