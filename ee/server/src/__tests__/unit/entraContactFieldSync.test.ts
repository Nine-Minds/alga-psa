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
});
