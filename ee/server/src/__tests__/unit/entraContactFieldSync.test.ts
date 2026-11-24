import { describe, expect, it } from 'vitest';
import { ContactModel } from '@alga-psa/shared/models/contactModel';
import {
  buildContactFieldSyncPatch,
  buildEntraContactPhoneNumbers,
  buildEntraContactPhoneRows,
  parseEntraPhoneValue,
} from '@ee/lib/integrations/entra/sync/contactFieldSync';
import type { EntraSyncUser } from '@ee/lib/integrations/entra/sync/types';

function buildUser(overrides: Partial<EntraSyncUser> = {}): EntraSyncUser {
  return {
    entraTenantId: 'entra-tenant-sync',
    entraObjectId: 'entra-object-sync',
    userPrincipalName: 'person@example.com',
    email: 'person@example.com',
    displayName: 'Person Example',
    givenName: 'Person',
    surname: 'Example',
    accountEnabled: true,
    jobTitle: 'Support Engineer',
    mobilePhone: '+1-555-0100',
    businessPhones: ['+1-555-0101'],
    raw: {},
    ...overrides,
  };
}

describe('buildContactFieldSyncPatch', () => {
  it('T100: display-name overwrite toggle OFF does not patch full_name', () => {
    const patch = buildContactFieldSyncPatch(buildUser({ displayName: 'Synced Display Name' }), {
      displayName: false,
      upn: false,
    });

    expect(patch).not.toHaveProperty('full_name');
  });

  it('T101: display-name overwrite toggle ON patches full_name for linked contacts', () => {
    const patch = buildContactFieldSyncPatch(buildUser({ displayName: 'Synced Display Name' }), {
      displayName: true,
    });

    expect(patch).toMatchObject({
      full_name: 'Synced Display Name',
    });
  });

  it('T102: UPN overwrite toggle ON patches entra_user_principal_name for linked contacts', () => {
    const patch = buildContactFieldSyncPatch(
      buildUser({
        userPrincipalName: 'updated.upn@example.com',
      }),
      {
        upn: true,
      }
    );

    expect(patch).toMatchObject({
      entra_user_principal_name: 'updated.upn@example.com',
    });
  });

  it('T033: phone overwrite maps Entra business and mobile phones into normalized contact phone rows', () => {
    const patch = buildContactFieldSyncPatch(
      buildUser({
        mobilePhone: '+1-555-0100',
        businessPhones: ['+1-555-0101', '+1-555-0102'],
      }),
      {
        phone: true,
      }
    );

    expect(patch).toMatchObject({
      phone_numbers: [
        {
          phone_number: '+1-555-0101',
          canonical_type: 'work',
          is_default: true,
          display_order: 0,
        },
        {
          phone_number: '+1-555-0102',
          canonical_type: 'work',
          is_default: false,
          display_order: 1,
        },
        {
          phone_number: '+1-555-0100',
          canonical_type: 'mobile',
          is_default: false,
          display_order: 2,
        },
      ],
    });
  });

  it('T034: phone overwrite default precedence prefers the first business phone, otherwise the mobile phone', () => {
    const businessPreferredPatch = buildContactFieldSyncPatch(
      buildUser({
        mobilePhone: '+1-555-0200',
        businessPhones: ['+1-555-0201'],
      }),
      {
        phone: true,
      }
    );

    expect((businessPreferredPatch.phone_numbers as Array<{ phone_number: string; is_default: boolean }>))
      .toEqual([
        expect.objectContaining({ phone_number: '+1-555-0201', is_default: true }),
        expect.objectContaining({ phone_number: '+1-555-0200', is_default: false }),
      ]);

    const mobileOnlyPatch = buildContactFieldSyncPatch(
      buildUser({
        mobilePhone: '+1-555-0300',
        businessPhones: [],
      }),
      {
        phone: true,
      }
    );

    expect(mobileOnlyPatch).toMatchObject({
      phone_numbers: [
        {
          phone_number: '+1-555-0300',
          canonical_type: 'mobile',
          is_default: true,
          display_order: 0,
        },
      ],
    });
  });
});

describe('parseEntraPhoneValue', () => {
  const cases: Array<[string, { phoneNumber: string; extension?: string; discardedExtension?: string }]> = [
    ['+14165551234;ext=228', { phoneNumber: '+14165551234', extension: '228' }],
    ['+1 416 555 1234 ; EXT = 228', { phoneNumber: '+1 416 555 1234', extension: '228' }],
    ['+14165551234;ext=', { phoneNumber: '+14165551234', discardedExtension: '' }],
    ['(416) 555-1234 ext. 228', { phoneNumber: '(416) 555-1234', extension: '228' }],
    ['416 555 1234 ext 2-28', { phoneNumber: '416 555 1234', extension: '228' }],
    ['+14165551234x228', { phoneNumber: '+14165551234', extension: '228' }],
    ['416-555-1234 x 228', { phoneNumber: '416-555-1234', extension: '228' }],
    ['(416)x228', { phoneNumber: '(416)', extension: '228' }],
    ['1-800-BOX1234', { phoneNumber: '1-800-BOX1234' }],
    ['1-800-FLOWERS', { phoneNumber: '1-800-FLOWERS' }],
    ['+1 416 555 1234', { phoneNumber: '+1 416 555 1234' }],
    ['+14165551234;ext=12345678901', { phoneNumber: '+14165551234', discardedExtension: '12345678901' }],
    ['+14165551234;ext=22a', { phoneNumber: '+14165551234', discardedExtension: '22a' }],
    [';ext=228', { phoneNumber: ';ext=228' }],
  ];

  it.each(cases)('T001: %s', (raw, expected) => {
    expect(parseEntraPhoneValue(raw)).toEqual(expected);
  });
});

describe('buildEntraContactPhoneNumbers', () => {
  it('T002: plain values produce exactly the rows they always did, with no extension key', () => {
    const rows = buildEntraContactPhoneNumbers(
      buildUser({ businessPhones: ['+1-555-0101', '+1-555-0102'], mobilePhone: '+1-555-0100' })
    );
    expect(rows).toEqual([
      { phone_number: '+1-555-0101', canonical_type: 'work', is_default: true, display_order: 0 },
      { phone_number: '+1-555-0102', canonical_type: 'work', is_default: false, display_order: 1 },
      { phone_number: '+1-555-0100', canonical_type: 'mobile', is_default: false, display_order: 2 },
    ]);
    rows.forEach((row) => expect(row).not.toHaveProperty('extension'));
  });

  it('T002: extension values set extension on the row', () => {
    const rows = buildEntraContactPhoneNumbers(
      buildUser({ businessPhones: ['+14165551234;ext=228'], mobilePhone: null })
    );
    expect(rows).toEqual([
      { phone_number: '+14165551234', extension: '228', canonical_type: 'work', is_default: true, display_order: 0 },
    ]);
  });

  it('T002: an over-long extension is dropped with a notice and the number is kept', () => {
    const { rows, notices } = buildEntraContactPhoneRows(
      buildUser({ businessPhones: [], mobilePhone: '+14165551234;ext=12345678901' })
    );
    expect(rows).toEqual([
      { phone_number: '+14165551234', canonical_type: 'mobile', is_default: true, display_order: 0 },
    ]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ field: 'phone_numbers', source: 'mobilePhone' });
  });

  it('T002: an unparseable value is skipped with a notice and the default moves on', () => {
    const { rows, notices } = buildEntraContactPhoneRows(
      buildUser({ businessPhones: ['+1416555;1234', '+1-555-0102'], mobilePhone: '+1-555-0100' })
    );
    expect(rows.map((row) => [row.phone_number, row.is_default, row.display_order])).toEqual([
      ['+1-555-0102', true, 0],
      ['+1-555-0100', false, 1],
    ]);
    expect(notices).toHaveLength(1);
    expect(notices[0].message).toContain('+1416555;1234');
  });

  it('T002: mobile becomes the default when every business phone was skipped; all invalid gives []', () => {
    const mobileDefault = buildEntraContactPhoneNumbers(
      buildUser({ businessPhones: ['n/a;x'], mobilePhone: '+1-555-0100' })
    );
    expect(mobileDefault).toEqual([
      { phone_number: '+1-555-0100', canonical_type: 'mobile', is_default: true, display_order: 0 },
    ]);

    const none = buildEntraContactPhoneRows(buildUser({ businessPhones: ['none', ';;'], mobilePhone: 'abc' }));
    expect(none.rows).toEqual([]);
    expect(none.notices).toHaveLength(3);
  });

  it('T002: every returned row passes ContactModel.validatePhoneNumbers', () => {
    const values = [
      '+14165551234;ext=228',
      '+1 416 555 1234 ; EXT = 228',
      '(416) 555-1234 ext. 228',
      '+14165551234x228',
      '1-800-BOX1234',
      '+14165551234;ext=12345678901',
      '+1416555;1234',
      '+1-555-0100',
    ];
    for (const value of values) {
      const rows = buildEntraContactPhoneNumbers(buildUser({ businessPhones: [value], mobilePhone: value }));
      if (rows.length === 0) continue;
      const validation = ContactModel.validatePhoneNumbers(rows);
      expect(validation, value).toMatchObject({ valid: true });
    }
  });
});
