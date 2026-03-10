import { describe, expect, it } from 'vitest';
import { buildContactFieldSyncPatch } from '@ee/lib/integrations/entra/sync/contactFieldSync';
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
