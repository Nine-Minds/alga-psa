import { describe, expect, it } from 'vitest';
import { filterEntraUsers } from '@ee/lib/integrations/entra/sync/userFilterPipeline';
import { EMPTY_ENTRA_USER_FILTER_CONFIG } from '@ee/lib/integrations/entra/sync/userFilterConfig';
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
    userType: 'Member',
    assignedLicenseCount: 1,
    jobTitle: null,
    mobilePhone: null,
    businessPhones: [],
    raw: {},
    ...overrides,
  };
}

describe('filterEntraUsers', () => {
  it('keeps the legacy filtering result with an empty configuration', () => {
    const users = [
      buildUser({ entraObjectId: 'member', userPrincipalName: 'person@example.com' }),
      buildUser({ entraObjectId: 'disabled', accountEnabled: false }),
      buildUser({ entraObjectId: 'service', userPrincipalName: 'svc-backup@example.com' }),
    ];
    const result = filterEntraUsers(users, EMPTY_ENTRA_USER_FILTER_CONFIG);
    expect(result).toEqual(filterEntraUsers(users));
    expect(result.included.map(user => user.entraObjectId)).toEqual(['member']);
    expect(result.excluded.map(item => [item.user.entraObjectId, item.reason])).toEqual([
      ['disabled', 'account_disabled'],
      ['service', 'service_account'],
    ]);
  });

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

  it('applies licensed and group rules in a stable order while retaining unknown provider data', () => {
    const users = [
      buildUser({ entraObjectId: 'guest', userType: 'Guest', assignedLicenseCount: 0 }),
      buildUser({ entraObjectId: 'unlicensed', assignedLicenseCount: 0 }),
      buildUser({ entraObjectId: 'excluded', assignedLicenseCount: 1 }),
      buildUser({ entraObjectId: 'unknown', userType: null, assignedLicenseCount: null }),
    ];
    const result = filterEntraUsers(users, { memberUsersOnly: true, licensedUsersOnly: true, includeGroupIds: ['allow'], excludeMemberIds: new Set(['excluded']), includeMemberIds: new Set(['unknown']) });
    expect(result.excluded.map((item) => item.reason)).toEqual(['guest_user', 'unlicensed', 'excluded_group']);
    expect(result.included.map((user) => user.entraObjectId)).toEqual(['unknown']);
    expect(result.unknownFieldCounts).toEqual({ userType: 1, assignedLicenseCount: 1 });
  });

  it('keeps missing licensed data and reports it when only license filtering is enabled', () => {
    const result = filterEntraUsers([buildUser({ userType: null, assignedLicenseCount: null })], { licensedUsersOnly: true });
    expect(result.included).toHaveLength(1);
    expect(result.unknownFieldCounts.assignedLicenseCount).toBe(1);
  });

  it('counts unknown fields only for included users', () => {
    const result = filterEntraUsers([
      buildUser({ entraObjectId: 'pattern-excluded', userType: null, assignedLicenseCount: null, userPrincipalName: 'blocked@example.com' }),
      buildUser({ entraObjectId: 'group-excluded', userType: null, assignedLicenseCount: null }),
      buildUser({ entraObjectId: 'included', userType: null, assignedLicenseCount: null }),
    ], {
      memberUsersOnly: true,
      licensedUsersOnly: true,
      customExclusionPatterns: ['blocked'],
      excludeMemberIds: new Set(['group-excluded']),
    });
    expect(result.excluded.map(item => item.reason)).toEqual(['tenant_custom_pattern', 'excluded_group']);
    expect(result.included.map(user => user.entraObjectId)).toEqual(['included']);
    expect(result.unknownFieldCounts).toEqual({ userType: 1, assignedLicenseCount: 1 });
  });
});
