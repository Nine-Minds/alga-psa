import { describe, expect, it } from 'vitest';
import { evaluateClientPortalProvisioningEligibility } from '@ee/lib/integrations/entra/sync/clientPortalProvisioning';
import type { EntraSyncUser } from '@ee/lib/integrations/entra/sync/types';

function buildUser(overrides: Partial<EntraSyncUser> = {}): EntraSyncUser {
  return {
    entraTenantId: 'entra-tenant-1',
    entraObjectId: 'entra-object-1',
    userPrincipalName: 'user@example.com',
    email: 'user@example.com',
    displayName: 'User One',
    givenName: 'User',
    surname: 'One',
    accountEnabled: true,
    jobTitle: null,
    mobilePhone: null,
    businessPhones: [],
    raw: {},
    ...overrides,
  };
}

describe('client portal provisioning eligibility', () => {
  it('T117: returns mode_disabled when client portal provisioning mode is disabled', () => {
    const result = evaluateClientPortalProvisioningEligibility(buildUser(), {
      provisioningMode: 'disabled',
      groupId: 'group-1',
      membershipMode: 'transitive',
    });
    expect(result).toEqual({ eligible: false, reason: 'mode_disabled' });
  });

  it('T118: returns missing_group when provisioning mode is enabled without an entitlement group', () => {
    const result = evaluateClientPortalProvisioningEligibility(buildUser(), {
      provisioningMode: 'built_in',
      groupId: null,
      membershipMode: 'transitive',
    });
    expect(result).toEqual({ eligible: false, reason: 'missing_group' });
  });

  it('T126/F067: returns workflow_managed when provisioning mode delegates to workflows', () => {
    const result = evaluateClientPortalProvisioningEligibility(buildUser(), {
      provisioningMode: 'workflow_managed',
      groupId: 'group-1',
      membershipMode: 'transitive',
    });
    expect(result).toEqual({ eligible: false, reason: 'workflow_managed' });
  });

  it('T119: returns missing_identity when user has neither email nor UPN', () => {
    const result = evaluateClientPortalProvisioningEligibility(
      buildUser({ email: null, userPrincipalName: null }),
      {
        provisioningMode: 'built_in',
        groupId: 'group-1',
        membershipMode: 'transitive',
      }
    );
    expect(result).toEqual({ eligible: false, reason: 'missing_identity' });
  });

  it('T120: returns missing_entitlement when user is not a member of the configured group', () => {
    const result = evaluateClientPortalProvisioningEligibility(
      buildUser({
        clientPortalEntitlement: {
          groupId: 'group-1',
          membershipMode: 'transitive',
          isMember: false,
        },
      }),
      {
        provisioningMode: 'built_in',
        groupId: 'group-1',
        membershipMode: 'transitive',
      }
    );
    expect(result).toEqual({ eligible: false, reason: 'missing_entitlement' });
  });

  it('T121: returns account_disabled when the Entra account is disabled', () => {
    const result = evaluateClientPortalProvisioningEligibility(
      buildUser({
        accountEnabled: false,
        clientPortalEntitlement: {
          groupId: 'group-1',
          membershipMode: 'transitive',
          isMember: true,
        },
      }),
      {
        provisioningMode: 'built_in',
        groupId: 'group-1',
        membershipMode: 'transitive',
      }
    );
    expect(result).toEqual({ eligible: false, reason: 'account_disabled' });
  });
});
