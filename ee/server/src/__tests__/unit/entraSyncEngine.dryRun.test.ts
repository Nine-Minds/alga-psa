import { describe, expect, it, vi } from 'vitest';
import type { EntraSyncUser } from '@ee/lib/integrations/entra/sync/types';

const findContactMatchesByEmailMock = vi.fn();
const queueAmbiguousContactMatchMock = vi.fn();
const linkExistingMatchedContactMock = vi.fn();
const createContactForEntraUserMock = vi.fn();
const evaluateClientPortalProvisioningEligibilityMock = vi.fn();
const handleEligibleClientPortalProvisioningMock = vi.fn();

vi.mock('@ee/lib/integrations/entra/sync/contactMatcher', () => ({
  findContactMatchesByEmail: findContactMatchesByEmailMock,
}));

vi.mock('@ee/lib/integrations/entra/sync/contactReconciler', () => ({
  queueAmbiguousContactMatch: queueAmbiguousContactMatchMock,
  linkExistingMatchedContact: linkExistingMatchedContactMock,
  createContactForEntraUser: createContactForEntraUserMock,
}));

vi.mock('@ee/lib/integrations/entra/sync/clientPortalProvisioning', () => ({
  evaluateClientPortalProvisioningEligibility: evaluateClientPortalProvisioningEligibilityMock,
  handleEligibleClientPortalProvisioning: handleEligibleClientPortalProvisioningMock,
}));

function buildUser(seed: string): EntraSyncUser {
  return {
    entraTenantId: 'entra-tenant-111',
    entraObjectId: `entra-object-${seed}`,
    userPrincipalName: `${seed}@example.com`,
    email: `${seed}@example.com`,
    displayName: `User ${seed}`,
    givenName: 'User',
    surname: seed,
    accountEnabled: true,
    jobTitle: null,
    mobilePhone: null,
    businessPhones: [],
    raw: {},
  };
}

describe('executeEntraSync dry-run behavior', () => {
  it('T111: returns preview counters without running any write paths', async () => {
    findContactMatchesByEmailMock.mockReset();
    queueAmbiguousContactMatchMock.mockReset();
    linkExistingMatchedContactMock.mockReset();
    createContactForEntraUserMock.mockReset();
    evaluateClientPortalProvisioningEligibilityMock.mockReset();
    handleEligibleClientPortalProvisioningMock.mockReset();

    findContactMatchesByEmailMock
      .mockResolvedValueOnce([
        {
          contactNameId: 'contact-amb-1',
          clientId: 'client-111',
          email: 'ambiguous@example.com',
          fullName: 'Ambiguous One',
          isInactive: false,
        },
        {
          contactNameId: 'contact-amb-2',
          clientId: 'client-111',
          email: 'ambiguous@example.com',
          fullName: 'Ambiguous Two',
          isInactive: false,
        },
      ])
      .mockResolvedValueOnce([
        {
          contactNameId: 'contact-linked',
          clientId: 'client-111',
          email: 'linked@example.com',
          fullName: 'Linked User',
          isInactive: false,
        },
      ])
      .mockResolvedValueOnce([]);

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    const result = await executeEntraSync({
      tenantId: 'tenant-111',
      clientId: 'client-111',
      managedTenantId: 'managed-111',
      dryRun: true,
      users: [buildUser('ambiguous'), buildUser('linked'), buildUser('created')],
    });

    expect(result).toEqual({
      dryRun: true,
      counters: {
        created: 1,
        linked: 1,
        updated: 0,
        ambiguous: 1,
        inactivated: 0,
      },
    });
    expect(findContactMatchesByEmailMock).toHaveBeenCalledTimes(3);
    expect(queueAmbiguousContactMatchMock).not.toHaveBeenCalled();
    expect(linkExistingMatchedContactMock).not.toHaveBeenCalled();
    expect(createContactForEntraUserMock).not.toHaveBeenCalled();
    expect(evaluateClientPortalProvisioningEligibilityMock).not.toHaveBeenCalled();
    expect(handleEligibleClientPortalProvisioningMock).not.toHaveBeenCalled();
  });

  it('T112: threads portal entitlement context into each sync user when provided', async () => {
    findContactMatchesByEmailMock.mockReset();
    queueAmbiguousContactMatchMock.mockReset();
    linkExistingMatchedContactMock.mockReset();
    createContactForEntraUserMock.mockReset();

    findContactMatchesByEmailMock.mockResolvedValueOnce([]);

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    await executeEntraSync({
      tenantId: 'tenant-112',
      clientId: 'client-112',
      managedTenantId: 'managed-112',
      dryRun: true,
      users: [buildUser('entitled')],
      portalEntitlement: {
        provisioningMode: 'built_in',
        groupId: 'group-112',
        membershipMode: 'transitive',
      },
    });

    expect(findContactMatchesByEmailMock).toHaveBeenCalledTimes(1);
    expect(findContactMatchesByEmailMock).toHaveBeenCalledWith(
      'tenant-112',
      'client-112',
      expect.objectContaining({
        entraObjectId: 'entra-object-entitled',
        clientPortalEntitlement: {
          groupId: 'group-112',
          membershipMode: 'transitive',
          isMember: null,
        },
      })
    );
  });

  it('T115: does not attempt portal provisioning for ambiguous reconciliation outcomes', async () => {
    findContactMatchesByEmailMock.mockReset();
    queueAmbiguousContactMatchMock.mockReset();
    linkExistingMatchedContactMock.mockReset();
    createContactForEntraUserMock.mockReset();
    evaluateClientPortalProvisioningEligibilityMock.mockReset();
    handleEligibleClientPortalProvisioningMock.mockReset();

    findContactMatchesByEmailMock.mockResolvedValueOnce([
      { contactNameId: 'c1' },
      { contactNameId: 'c2' },
    ]);
    linkExistingMatchedContactMock.mockResolvedValue({ contactNameId: 'contact-115' });
    createContactForEntraUserMock.mockResolvedValue({ contactNameId: 'contact-115' });

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    await executeEntraSync({
      tenantId: 'tenant-115',
      clientId: 'client-115',
      managedTenantId: 'managed-115',
      dryRun: false,
      users: [buildUser('ambiguous')],
      portalEntitlement: {
        provisioningMode: 'built_in',
        groupId: 'group-115',
        membershipMode: 'transitive',
      },
    });

    expect(queueAmbiguousContactMatchMock).toHaveBeenCalledTimes(1);
    expect(evaluateClientPortalProvisioningEligibilityMock).not.toHaveBeenCalled();
    expect(handleEligibleClientPortalProvisioningMock).not.toHaveBeenCalled();
  });

  it('T116: skips provisioning when mode is disabled after successful reconciliation', async () => {
    findContactMatchesByEmailMock.mockReset();
    queueAmbiguousContactMatchMock.mockReset();
    linkExistingMatchedContactMock.mockReset();
    createContactForEntraUserMock.mockReset();
    evaluateClientPortalProvisioningEligibilityMock.mockReset();
    handleEligibleClientPortalProvisioningMock.mockReset();

    findContactMatchesByEmailMock.mockResolvedValueOnce([
      {
        contactNameId: 'contact-116',
        clientId: 'client-116',
        email: 'linked116@example.com',
        fullName: 'Linked 116',
        isInactive: false,
      },
    ]);
    evaluateClientPortalProvisioningEligibilityMock.mockReturnValue({
      eligible: false,
      reason: 'mode_disabled',
    });
    linkExistingMatchedContactMock.mockResolvedValue({ contactNameId: 'contact-116' });

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    await executeEntraSync({
      tenantId: 'tenant-116',
      clientId: 'client-116',
      managedTenantId: 'managed-116',
      dryRun: false,
      users: [buildUser('linked116')],
      portalEntitlement: {
        provisioningMode: 'disabled',
        groupId: 'group-116',
        membershipMode: 'transitive',
      },
    });

    expect(linkExistingMatchedContactMock).toHaveBeenCalledTimes(1);
    expect(evaluateClientPortalProvisioningEligibilityMock).toHaveBeenCalledTimes(1);
    expect(handleEligibleClientPortalProvisioningMock).not.toHaveBeenCalled();
  });

  it('T125/T012: skips portal provisioning when entitlement group is not configured', async () => {
    findContactMatchesByEmailMock.mockReset();
    linkExistingMatchedContactMock.mockReset();
    evaluateClientPortalProvisioningEligibilityMock.mockReset();
    handleEligibleClientPortalProvisioningMock.mockReset();

    findContactMatchesByEmailMock.mockResolvedValueOnce([
      {
        contactNameId: 'contact-125',
        clientId: 'client-125',
        email: 'linked125@example.com',
        fullName: 'Linked 125',
        isInactive: false,
      },
    ]);
    linkExistingMatchedContactMock.mockResolvedValue({ contactNameId: 'contact-125' });
    evaluateClientPortalProvisioningEligibilityMock.mockReturnValue({
      eligible: false,
      reason: 'missing_group',
    });

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    await executeEntraSync({
      tenantId: 'tenant-125',
      clientId: 'client-125',
      managedTenantId: 'managed-125',
      dryRun: false,
      users: [buildUser('linked125')],
      portalEntitlement: {
        provisioningMode: 'built_in',
        groupId: null,
        membershipMode: 'transitive',
      },
    });

    expect(linkExistingMatchedContactMock).toHaveBeenCalledTimes(1);
    expect(handleEligibleClientPortalProvisioningMock).not.toHaveBeenCalled();
  });
});
