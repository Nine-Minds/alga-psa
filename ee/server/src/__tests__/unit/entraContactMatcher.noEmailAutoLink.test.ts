import { describe, expect, it } from 'vitest';
import { canAutoLinkEntraUserByEmail } from '@ee/lib/integrations/entra/sync/contactMatcher';
import type { EntraSyncUser } from '@ee/lib/integrations/entra/sync/types';

function buildUser(overrides: Partial<EntraSyncUser>): EntraSyncUser {
  return {
    entraTenantId: 'entra-tenant-98',
    entraObjectId: 'entra-object-98',
    userPrincipalName: 'user98@example.com',
    email: 'user98@example.com',
    displayName: 'User 98',
    givenName: 'User',
    surname: 'Ninety Eight',
    accountEnabled: true,
    jobTitle: null,
    mobilePhone: null,
    businessPhones: [],
    raw: {},
    ...overrides,
  };
}

describe('canAutoLinkEntraUserByEmail', () => {
  it('T098: name-only identities without valid email do not auto-link', () => {
    const canAutoLink = canAutoLinkEntraUserByEmail(
      buildUser({
        userPrincipalName: 'Name Only User',
        email: null,
        displayName: 'Name Only User',
      })
    );

    expect(canAutoLink).toBe(false);
  });
});
