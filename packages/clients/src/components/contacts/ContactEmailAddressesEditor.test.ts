import { describe, expect, it } from 'vitest';

import {
  appendKeptOldPrimaryEmail,
  compactContactEmailAddresses,
  moveContactEmailRows,
  normalizeDraftContactEmailAddresses,
  promoteContactEmailRow,
  shouldOfferKeepOldPrimaryEmail,
  validateContactEmailAddresses,
} from './ContactEmailAddressesEditor';

describe('ContactEmailAddressesEditor helpers', () => {
  it('preserves a custom primary label and additional row ordering during normalization', () => {
    const normalized = normalizeDraftContactEmailAddresses({
      email: 'primary@example.com',
      primary_email_canonical_type: null,
      primary_email_type: 'Escalations',
      additional_email_addresses: [
        {
          email_address: 'billing@example.com',
          canonical_type: 'billing',
          custom_type: null,
          display_order: 4,
        },
      ],
    });

    expect(normalized).toEqual({
      email: 'primary@example.com',
      primary_email_canonical_type: null,
      primary_email_custom_type: 'Escalations',
      additional_email_addresses: [
        {
          contact_additional_email_address_id: undefined,
          email_address: 'billing@example.com',
          canonical_type: 'billing',
          custom_type: null,
          display_order: 0,
        },
      ],
    });
  });

  it('compacts blank additional rows and normalizes display order', () => {
    const compacted = compactContactEmailAddresses({
      email: 'primary@example.com',
      primary_email_canonical_type: 'work',
      additional_email_addresses: [
        {
          email_address: 'billing@example.com',
          canonical_type: 'billing',
          custom_type: null,
          display_order: 9,
        },
        {
          email_address: '',
          canonical_type: null,
          custom_type: '',
          display_order: 12,
        },
      ],
    });

    expect(compacted.additional_email_addresses).toEqual([
      {
        contact_additional_email_address_id: undefined,
        email_address: 'billing@example.com',
        canonical_type: 'billing',
        custom_type: null,
        display_order: 0,
      },
    ]);
  });

  it('promotes an additional email into the primary slot and demotes the previous primary row', () => {
    const promoted = promoteContactEmailRow({
      email: 'primary@example.com',
      primary_email_canonical_type: 'work',
      additional_email_addresses: [
        {
          email_address: 'billing@example.com',
          canonical_type: 'billing',
          custom_type: null,
          display_order: 0,
        },
        {
          email_address: 'alerts@example.com',
          canonical_type: null,
          custom_type: 'Escalations',
          display_order: 1,
        },
      ],
    }, 1);

    expect(promoted).toEqual({
      email: 'alerts@example.com',
      primary_email_canonical_type: null,
      primary_email_custom_type: 'Escalations',
      additional_email_addresses: [
        {
          contact_additional_email_address_id: undefined,
          email_address: 'billing@example.com',
          canonical_type: 'billing',
          custom_type: null,
          display_order: 0,
        },
        {
          email_address: 'primary@example.com',
          canonical_type: 'work',
          custom_type: null,
          display_order: 1,
        },
      ],
    });
  });

  it('flags duplicate additional emails and incomplete custom labels', () => {
    expect(
      validateContactEmailAddresses({
        email: 'primary@example.com',
        primary_email_canonical_type: 'work',
        additional_email_addresses: [
          {
            email_address: 'billing@example.com',
            canonical_type: 'billing',
            custom_type: null,
            display_order: 0,
          },
          {
            email_address: 'billing@example.com',
            canonical_type: null,
            custom_type: '',
            display_order: 1,
          },
        ],
      })
    ).toEqual(expect.arrayContaining([
      'Additional email 2: Additional email addresses must be unique.',
      'Additional email 2: Enter a custom email label.',
    ]));
  });

  it('preserves row data while reordering additional email rows', () => {
    const movedRows = moveContactEmailRows(
      [
        {
          email_address: 'billing@example.com',
          canonical_type: 'billing',
          custom_type: null,
          display_order: 0,
          _localId: 'row-1',
        },
        {
          email_address: 'alerts@example.com',
          canonical_type: null,
          custom_type: 'Escalations',
          display_order: 1,
          _localId: 'row-2',
        },
      ],
      1,
      -1
    );

    expect(movedRows[0]).toMatchObject({
      email_address: 'alerts@example.com',
      canonical_type: null,
      custom_type: 'Escalations',
      _localId: 'row-2',
      display_order: 0,
    });
    expect(movedRows[1]).toMatchObject({
      email_address: 'billing@example.com',
      canonical_type: 'billing',
      _localId: 'row-1',
      display_order: 1,
    });
  });

  it('offers to keep the old primary email only for a saved address the user changed', () => {
    expect(shouldOfferKeepOldPrimaryEmail('primary@example.com', 'corrected@example.com')).toBe(true);
    expect(shouldOfferKeepOldPrimaryEmail('primary@example.com', ' PRIMARY@example.com ')).toBe(false);
    expect(shouldOfferKeepOldPrimaryEmail('primary@example.com', '')).toBe(false);
    expect(shouldOfferKeepOldPrimaryEmail(null, 'corrected@example.com')).toBe(false);
    expect(shouldOfferKeepOldPrimaryEmail(undefined, 'corrected@example.com')).toBe(false);
  });

  it('appends the kept old primary email as a last additional row carrying the primary label', () => {
    expect(appendKeptOldPrimaryEmail({
      email: 'corrected@example.com',
      primary_email_canonical_type: null,
      primary_email_custom_type: 'Escalations',
      additional_email_addresses: [
        {
          email_address: 'billing@example.com',
          canonical_type: 'billing',
          custom_type: null,
          display_order: 0,
        },
      ],
    }, 'primary@example.com')).toEqual({
      email: 'corrected@example.com',
      primary_email_canonical_type: null,
      primary_email_custom_type: 'Escalations',
      additional_email_addresses: [
        {
          email_address: 'billing@example.com',
          canonical_type: 'billing',
          custom_type: null,
          display_order: 0,
        },
        {
          email_address: 'primary@example.com',
          canonical_type: null,
          custom_type: 'Escalations',
          display_order: 1,
        },
      ],
    });
  });

  it('leaves the rows alone when the old primary email is absent, unchanged or already listed', () => {
    const value = {
      email: 'corrected@example.com',
      primary_email_canonical_type: 'work' as const,
      primary_email_custom_type: null,
      additional_email_addresses: [
        {
          email_address: 'primary@example.com',
          canonical_type: 'work' as const,
          custom_type: null,
          display_order: 0,
        },
      ],
    };

    expect(appendKeptOldPrimaryEmail(value, 'primary@example.com')).toBe(value);
    expect(appendKeptOldPrimaryEmail(value, null)).toBe(value);
    expect(appendKeptOldPrimaryEmail({ ...value, additional_email_addresses: [] }, 'corrected@example.com'))
      .toEqual({ ...value, additional_email_addresses: [] });
  });

  it('allows reusing a custom email label across rows because custom labels are tenant-scoped suggestions', () => {
    expect(
      validateContactEmailAddresses({
        email: 'primary@example.com',
        primary_email_canonical_type: null,
        primary_email_custom_type: 'Escalations',
        additional_email_addresses: [
          {
            email_address: 'alerts@example.com',
            canonical_type: null,
            custom_type: 'Escalations',
            display_order: 0,
          },
        ],
      })
    ).toEqual([]);
  });
});
