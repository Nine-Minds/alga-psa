import { describe, expect, it } from 'vitest';
import { filterEntraUsers } from '@ee/lib/integrations/entra/sync/userFilterPipeline';
import type { EntraSyncUser } from '@ee/lib/integrations/entra/sync/types';

function buildUser(overrides: Partial<EntraSyncUser>): EntraSyncUser {
  return {
    entraTenantId: 'entra-tenant-test',
    entraObjectId: 'entra-object-test',
    userPrincipalName: 'user@example.com',
    email: 'user@example.com',
    displayName: 'Normal User',
    givenName: 'Normal',
    surname: 'User',
    accountEnabled: true,
    jobTitle: null,
    mobilePhone: null,
    businessPhones: [],
    raw: {},
    ...overrides,
  };
}

describe('filterEntraUsers', () => {
  it('T091: excludes disabled Entra users (accountEnabled=false)', () => {
    const result = filterEntraUsers([
      buildUser({
        entraObjectId: 'disabled-91',
        accountEnabled: false,
      }),
    ]);

    expect(result.included).toHaveLength(0);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]).toMatchObject({
      reason: 'account_disabled',
      user: expect.objectContaining({ entraObjectId: 'disabled-91' }),
    });
  });

  it('T092: excludes users missing valid UPN/email identity', () => {
    const result = filterEntraUsers([
      buildUser({
        entraObjectId: 'missing-id-92',
        userPrincipalName: 'not-an-email-identity',
        email: null,
      }),
    ]);

    expect(result.included).toHaveLength(0);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]).toMatchObject({
      reason: 'missing_identity',
      user: expect.objectContaining({ entraObjectId: 'missing-id-92' }),
    });
  });

  it('T093: excludes service-account-like identities using default patterns', () => {
    const result = filterEntraUsers([
      buildUser({
        entraObjectId: 'service-93',
        userPrincipalName: 'svc-backup@example.com',
        email: 'svc-backup@example.com',
        displayName: 'Svc Backup',
      }),
    ]);

    expect(result.included).toHaveLength(0);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]).toMatchObject({
      reason: 'service_account',
      user: expect.objectContaining({ entraObjectId: 'service-93' }),
    });
  });

  it('T094: applies tenant custom exclusion patterns on top of default filters', () => {
    const result = filterEntraUsers(
      [
        buildUser({
          entraObjectId: 'custom-94',
          userPrincipalName: 'engineer@example.com',
          email: 'engineer@example.com',
          displayName: 'Engineer Temp',
        }),
      ],
      {
        customExclusionPatterns: ['temp$'],
      }
    );

    expect(result.included).toHaveLength(0);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]).toMatchObject({
      reason: 'tenant_custom_pattern',
      user: expect.objectContaining({ entraObjectId: 'custom-94' }),
    });
  });
});
