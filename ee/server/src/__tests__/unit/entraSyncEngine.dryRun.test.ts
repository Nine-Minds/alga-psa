import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntraSyncUser } from '@ee/lib/integrations/entra/sync/types';

const findContactMatchesByEmailMock = vi.fn();
const queueAmbiguousContactMatchMock = vi.fn();
const linkExistingMatchedContactMock = vi.fn();
const createContactForEntraUserMock = vi.fn();
const evaluateClientPortalProvisioningEligibilityMock = vi.fn();
const handleEligibleClientPortalProvisioningMock = vi.fn();
const handleIneligibleClientPortalLifecycleMock = vi.fn();
const publishWorkflowManagedPortalProvisioningEventMock = vi.fn();
const previewLinkedContactChangeMock = vi.fn();
const markDisabledEntraUsersInactiveMock = vi.fn();
const selectLinkedEntraIdentitiesMock = vi.fn();

/**
 * The engine consults the portal-provisioning hooks on every non-dry-run
 * reconciliation, so suites that only care about counters still need them to
 * answer something. Ineligible-with-no-action is the neutral answer.
 */
function resetPortalProvisioningMocks(): void {
  evaluateClientPortalProvisioningEligibilityMock.mockReset();
  handleEligibleClientPortalProvisioningMock.mockReset();
  handleIneligibleClientPortalLifecycleMock.mockReset();
  publishWorkflowManagedPortalProvisioningEventMock.mockReset();
  evaluateClientPortalProvisioningEligibilityMock.mockReturnValue({
    eligible: false,
    reason: 'mode_disabled',
  });
  handleEligibleClientPortalProvisioningMock.mockResolvedValue({ outcome: 'provisioned' });
  handleIneligibleClientPortalLifecycleMock.mockResolvedValue({ outcome: 'none' });
}

vi.mock('@ee/lib/integrations/entra/sync/contactMatcher', () => ({
  findContactMatchesByEmail: findContactMatchesByEmailMock,
}));

vi.mock('@ee/lib/integrations/entra/sync/contactReconciler', () => ({
  queueAmbiguousContactMatch: queueAmbiguousContactMatchMock,
  linkExistingMatchedContact: linkExistingMatchedContactMock,
  createContactForEntraUser: createContactForEntraUserMock,
  previewLinkedContactChange: previewLinkedContactChangeMock,
}));

vi.mock('@ee/lib/integrations/entra/sync/disableHandler', () => ({
  markDisabledEntraUsersInactive: markDisabledEntraUsersInactiveMock,
  selectLinkedEntraIdentities: selectLinkedEntraIdentitiesMock,
}));

vi.mock('@ee/lib/integrations/entra/sync/clientPortalProvisioning', () => ({
  evaluateClientPortalProvisioningEligibility: evaluateClientPortalProvisioningEligibilityMock,
  handleEligibleClientPortalProvisioning: handleEligibleClientPortalProvisioningMock,
  handleIneligibleClientPortalLifecycle: handleIneligibleClientPortalLifecycleMock,
}));

vi.mock('@ee/lib/integrations/entra/sync/workflowManagedProvisioning', () => ({
  publishWorkflowManagedPortalProvisioningEvent:
    publishWorkflowManagedPortalProvisioningEventMock,
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
    resetPortalProvisioningMocks();
    previewLinkedContactChangeMock.mockReset();
    previewLinkedContactChangeMock.mockResolvedValue({ alreadyLinked: false, fieldsWouldChange: false });

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

    expect(result.dryRun).toBe(true);
    expect(result.counters).toEqual({
      created: 1,
      linked: 1,
      updated: 0,
      ambiguous: 1,
      inactivated: 0,
      skipped: 0,
    });
    expect(result.preview?.map((identity) => identity.bucket)).toEqual([
      'needs_decision',
      'link',
      'create',
    ]);
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
    handleIneligibleClientPortalLifecycleMock.mockReset();
    handleIneligibleClientPortalLifecycleMock.mockResolvedValue({ outcome: 'none' });
    handleEligibleClientPortalProvisioningMock.mockResolvedValue({ outcome: 'provisioned' });

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
    handleIneligibleClientPortalLifecycleMock.mockReset();
    handleIneligibleClientPortalLifecycleMock.mockResolvedValue({ outcome: 'none' });
    handleEligibleClientPortalProvisioningMock.mockResolvedValue({ outcome: 'provisioned' });

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
    handleIneligibleClientPortalLifecycleMock.mockReset();
    handleIneligibleClientPortalLifecycleMock.mockResolvedValue({ outcome: 'none' });
    handleEligibleClientPortalProvisioningMock.mockResolvedValue({ outcome: 'provisioned' });

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

  it('T127/F067: does not run built-in provisioning mutations in workflow-managed mode', async () => {
    findContactMatchesByEmailMock.mockReset();
    linkExistingMatchedContactMock.mockReset();
    evaluateClientPortalProvisioningEligibilityMock.mockReset();
    handleEligibleClientPortalProvisioningMock.mockReset();
    handleIneligibleClientPortalLifecycleMock.mockReset();
    handleIneligibleClientPortalLifecycleMock.mockResolvedValue({ outcome: 'none' });
    handleEligibleClientPortalProvisioningMock.mockResolvedValue({ outcome: 'provisioned' });

    findContactMatchesByEmailMock.mockResolvedValueOnce([
      {
        contactNameId: 'contact-127',
        clientId: 'client-127',
        email: 'linked127@example.com',
        fullName: 'Linked 127',
        isInactive: false,
      },
    ]);
    linkExistingMatchedContactMock.mockResolvedValue({ contactNameId: 'contact-127' });
    evaluateClientPortalProvisioningEligibilityMock.mockReturnValue({
      eligible: false,
      reason: 'workflow_managed',
    });

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    await executeEntraSync({
      tenantId: 'tenant-127',
      clientId: 'client-127',
      managedTenantId: 'managed-127',
      dryRun: false,
      users: [buildUser('linked127')],
      portalEntitlement: {
        provisioningMode: 'workflow_managed',
        groupId: 'group-127',
        membershipMode: 'transitive',
      },
    });

    expect(linkExistingMatchedContactMock).toHaveBeenCalledTimes(1);
    expect(handleEligibleClientPortalProvisioningMock).not.toHaveBeenCalled();
  });

  it('T128/T013: runs built-in provisioning hook after successful non-ambiguous reconciliation when eligible', async () => {
    findContactMatchesByEmailMock.mockReset();
    linkExistingMatchedContactMock.mockReset();
    evaluateClientPortalProvisioningEligibilityMock.mockReset();
    handleEligibleClientPortalProvisioningMock.mockReset();
    handleIneligibleClientPortalLifecycleMock.mockReset();
    handleIneligibleClientPortalLifecycleMock.mockResolvedValue({ outcome: 'none' });
    handleEligibleClientPortalProvisioningMock.mockResolvedValue({ outcome: 'provisioned' });

    findContactMatchesByEmailMock.mockResolvedValueOnce([
      {
        contactNameId: 'contact-128',
        clientId: 'client-128',
        email: 'linked128@example.com',
        fullName: 'Linked 128',
        isInactive: false,
      },
    ]);
    linkExistingMatchedContactMock.mockResolvedValue({ contactNameId: 'contact-128' });
    evaluateClientPortalProvisioningEligibilityMock.mockReturnValue({
      eligible: true,
      reason: 'eligible',
    });

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    await executeEntraSync({
      tenantId: 'tenant-128',
      clientId: 'client-128',
      managedTenantId: 'managed-128',
      dryRun: false,
      users: [buildUser('linked128')],
      portalEntitlement: {
        provisioningMode: 'built_in',
        groupId: 'group-128',
        membershipMode: 'transitive',
      },
    });

    expect(handleEligibleClientPortalProvisioningMock).toHaveBeenCalledTimes(1);
    expect(handleEligibleClientPortalProvisioningMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-128',
        clientId: 'client-128',
        managedTenantId: 'managed-128',
        contactNameId: 'contact-128',
      }),
      expect.objectContaining({
        entraObjectId: 'entra-object-linked128',
      })
    );
  });

  it('T131/T014: records skipped conflict outcome when provisioning detects portal-user conflicts', async () => {
    findContactMatchesByEmailMock.mockReset();
    linkExistingMatchedContactMock.mockReset();
    evaluateClientPortalProvisioningEligibilityMock.mockReset();
    handleEligibleClientPortalProvisioningMock.mockReset();
    handleIneligibleClientPortalLifecycleMock.mockReset();
    handleIneligibleClientPortalLifecycleMock.mockResolvedValue({ outcome: 'none' });

    findContactMatchesByEmailMock.mockResolvedValueOnce([
      {
        contactNameId: 'contact-131',
        clientId: 'client-131',
        email: 'linked131@example.com',
        fullName: 'Linked 131',
        isInactive: false,
      },
    ]);
    linkExistingMatchedContactMock.mockResolvedValue({ contactNameId: 'contact-131' });
    evaluateClientPortalProvisioningEligibilityMock.mockReturnValue({
      eligible: true,
      reason: 'eligible',
    });
    handleEligibleClientPortalProvisioningMock.mockResolvedValue({
      outcome: 'skipped_conflict',
      reason: 'email_conflict',
    });

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    const result = await executeEntraSync({
      tenantId: 'tenant-131',
      clientId: 'client-131',
      managedTenantId: 'managed-131',
      dryRun: false,
      users: [buildUser('linked131')],
      portalEntitlement: {
        provisioningMode: 'built_in',
        groupId: 'group-131',
        membershipMode: 'transitive',
      },
    });

    expect(result.counters).toMatchObject({
      linked: 1,
      skipped: 1,
      created: 0,
      ambiguous: 0,
    });
  });

  it('T132/T015: increments inactivated count when entitlement removal deactivates an Entra-managed portal user', async () => {
    findContactMatchesByEmailMock.mockReset();
    linkExistingMatchedContactMock.mockReset();
    evaluateClientPortalProvisioningEligibilityMock.mockReset();
    handleEligibleClientPortalProvisioningMock.mockReset();
    handleIneligibleClientPortalLifecycleMock.mockReset();
    handleIneligibleClientPortalLifecycleMock.mockResolvedValue({
      outcome: 'deactivated',
      reason: 'missing_entitlement',
    });

    findContactMatchesByEmailMock.mockResolvedValueOnce([
      { contactNameId: 'contact-132', clientId: 'client-132', email: 'linked132@example.com' },
    ]);
    linkExistingMatchedContactMock.mockResolvedValue({ contactNameId: 'contact-132' });
    evaluateClientPortalProvisioningEligibilityMock.mockReturnValue({
      eligible: false,
      reason: 'missing_entitlement',
    });

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    const result = await executeEntraSync({
      tenantId: 'tenant-132',
      clientId: 'client-132',
      managedTenantId: 'managed-132',
      dryRun: false,
      users: [buildUser('linked132')],
      portalEntitlement: {
        provisioningMode: 'built_in',
        groupId: 'group-132',
        membershipMode: 'transitive',
        deactivateOnEntitlementRemoval: true,
      },
    });
    expect(result.counters.inactivated).toBe(1);
    expect(handleEligibleClientPortalProvisioningMock).not.toHaveBeenCalled();
  });

  it('T133/T016: increments inactivated count when disabled Entra account deactivates an Entra-managed portal user', async () => {
    findContactMatchesByEmailMock.mockReset();
    linkExistingMatchedContactMock.mockReset();
    evaluateClientPortalProvisioningEligibilityMock.mockReset();
    handleEligibleClientPortalProvisioningMock.mockReset();
    handleIneligibleClientPortalLifecycleMock.mockReset();
    handleIneligibleClientPortalLifecycleMock.mockResolvedValue({
      outcome: 'deactivated',
      reason: 'account_disabled',
    });

    findContactMatchesByEmailMock.mockResolvedValueOnce([
      { contactNameId: 'contact-133', clientId: 'client-133', email: 'linked133@example.com' },
    ]);
    linkExistingMatchedContactMock.mockResolvedValue({ contactNameId: 'contact-133' });
    evaluateClientPortalProvisioningEligibilityMock.mockReturnValue({
      eligible: false,
      reason: 'account_disabled',
    });

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    const result = await executeEntraSync({
      tenantId: 'tenant-133',
      clientId: 'client-133',
      managedTenantId: 'managed-133',
      dryRun: false,
      users: [buildUser('linked133')],
      portalEntitlement: {
        provisioningMode: 'built_in',
        groupId: 'group-133',
        membershipMode: 'transitive',
        deactivateOnEntitlementRemoval: true,
      },
    });
    expect(result.counters.inactivated).toBe(1);
    expect(handleEligibleClientPortalProvisioningMock).not.toHaveBeenCalled();
  });

  it('T023/F069/F071: workflow-managed mode publishes eligible access event and skips built-in provisioning', async () => {
    findContactMatchesByEmailMock.mockReset();
    linkExistingMatchedContactMock.mockReset();
    evaluateClientPortalProvisioningEligibilityMock.mockReset();
    handleEligibleClientPortalProvisioningMock.mockReset();
    handleIneligibleClientPortalLifecycleMock.mockReset();
    publishWorkflowManagedPortalProvisioningEventMock.mockReset();

    findContactMatchesByEmailMock.mockResolvedValueOnce([
      { contactNameId: 'contact-223', clientId: 'client-223', email: 'eligible223@example.com' },
    ]);
    linkExistingMatchedContactMock.mockResolvedValue({ contactNameId: 'contact-223' });
    evaluateClientPortalProvisioningEligibilityMock.mockReturnValue({
      eligible: false,
      reason: 'workflow_managed',
    });
    publishWorkflowManagedPortalProvisioningEventMock.mockResolvedValue(
      'ENTRA_PORTAL_ACCESS_ELIGIBLE'
    );

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    await executeEntraSync({
      tenantId: 'tenant-223',
      clientId: 'client-223',
      managedTenantId: 'managed-223',
      syncRunId: 'run-223',
      dryRun: false,
      users: [
        {
          ...buildUser('linked223'),
          accountEnabled: true,
          clientPortalEntitlement: { groupId: 'group-223', membershipMode: 'transitive', isMember: true },
        },
      ],
      portalEntitlement: {
        provisioningMode: 'workflow_managed',
        groupId: 'group-223',
        membershipMode: 'transitive',
        defaultRoleName: 'User',
        workflowTarget: 'workflow-223',
      },
    });

    expect(publishWorkflowManagedPortalProvisioningEventMock).toHaveBeenCalledTimes(1);
    expect(publishWorkflowManagedPortalProvisioningEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-223',
        clientId: 'client-223',
        contactNameId: 'contact-223',
        syncRunId: 'run-223',
        workflowTarget: 'workflow-223',
      }),
      expect.objectContaining({
        entraObjectId: 'entra-object-linked223',
      })
    );
    expect(handleEligibleClientPortalProvisioningMock).not.toHaveBeenCalled();
    expect(handleIneligibleClientPortalLifecycleMock).not.toHaveBeenCalled();
  });

  it('T024/F070/F071: workflow-managed mode publishes access-removed event on entitlement loss or disabled account', async () => {
    findContactMatchesByEmailMock.mockReset();
    linkExistingMatchedContactMock.mockReset();
    evaluateClientPortalProvisioningEligibilityMock.mockReset();
    handleEligibleClientPortalProvisioningMock.mockReset();
    handleIneligibleClientPortalLifecycleMock.mockReset();
    publishWorkflowManagedPortalProvisioningEventMock.mockReset();

    findContactMatchesByEmailMock.mockResolvedValueOnce([
      { contactNameId: 'contact-224', clientId: 'client-224', email: 'removed224@example.com' },
    ]);
    linkExistingMatchedContactMock.mockResolvedValue({ contactNameId: 'contact-224' });
    evaluateClientPortalProvisioningEligibilityMock.mockReturnValue({
      eligible: false,
      reason: 'workflow_managed',
    });
    publishWorkflowManagedPortalProvisioningEventMock.mockResolvedValue(
      'ENTRA_PORTAL_ACCESS_REMOVED'
    );

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    await executeEntraSync({
      tenantId: 'tenant-224',
      clientId: 'client-224',
      managedTenantId: 'managed-224',
      syncRunId: 'run-224',
      dryRun: false,
      users: [
        {
          ...buildUser('linked224'),
          accountEnabled: false,
          clientPortalEntitlement: { groupId: 'group-224', membershipMode: 'transitive', isMember: false },
        },
      ],
      portalEntitlement: {
        provisioningMode: 'workflow_managed',
        groupId: 'group-224',
        membershipMode: 'transitive',
        defaultRoleName: 'User',
        workflowTarget: 'workflow-224',
      },
    });

    expect(publishWorkflowManagedPortalProvisioningEventMock).toHaveBeenCalledTimes(1);
    expect(handleEligibleClientPortalProvisioningMock).not.toHaveBeenCalled();
    expect(handleIneligibleClientPortalLifecycleMock).not.toHaveBeenCalled();
  });
});

describe('executeEntraSync updated counter', () => {
  beforeEach(() => {
    findContactMatchesByEmailMock.mockReset();
    queueAmbiguousContactMatchMock.mockReset();
    linkExistingMatchedContactMock.mockReset();
    createContactForEntraUserMock.mockReset();
    resetPortalProvisioningMocks();
    previewLinkedContactChangeMock.mockReset();
    markDisabledEntraUsersInactiveMock.mockReset();
    selectLinkedEntraIdentitiesMock.mockReset();
    selectLinkedEntraIdentitiesMock.mockResolvedValue([]);
  });

  const matchFor = (seed: string) => [
    {
      contactNameId: `contact-${seed}`,
      clientId: 'client-222',
      email: `${seed}@example.com`,
      fullName: `User ${seed}`,
      isInactive: false,
    },
  ];

  it('counts a link that overwrote a field as updated', async () => {
    findContactMatchesByEmailMock.mockResolvedValue(matchFor('overwritten'));
    linkExistingMatchedContactMock.mockResolvedValue({
      action: 'linked',
      fieldsUpdated: true,
      contactNameId: 'contact-overwritten',
      linkIdentity: { entraTenantId: 'entra-tenant-111', entraObjectId: 'entra-object-overwritten' },
    });

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    const result = await executeEntraSync({
      tenantId: 'tenant-222',
      clientId: 'client-222',
      managedTenantId: 'managed-222',
      fieldSyncConfig: { displayName: true },
      users: [buildUser('overwritten')],
    });

    expect(result.counters).toEqual({
      created: 0,
      linked: 1,
      updated: 1,
      ambiguous: 0,
      inactivated: 0,
      skipped: 0,
    });
  });

  it('leaves updated at zero when a link changed nothing', async () => {
    findContactMatchesByEmailMock.mockResolvedValue(matchFor('unchanged'));
    linkExistingMatchedContactMock.mockResolvedValue({
      action: 'linked',
      fieldsUpdated: false,
      contactNameId: 'contact-unchanged',
      linkIdentity: { entraTenantId: 'entra-tenant-111', entraObjectId: 'entra-object-unchanged' },
    });

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    const result = await executeEntraSync({
      tenantId: 'tenant-222',
      clientId: 'client-222',
      managedTenantId: 'managed-222',
      users: [buildUser('unchanged')],
    });

    expect(result.counters.linked).toBe(1);
    expect(result.counters.updated).toBe(0);
  });
});

describe('executeEntraSync inactivation is inside the dry-run guard', () => {
  const disabled = [
    {
      entraTenantId: 'entra-tenant-111',
      entraObjectId: 'entra-object-disabled',
      displayName: 'Disabled User',
      email: 'disabled@example.com',
      userPrincipalName: 'disabled@example.com',
    },
  ];

  beforeEach(() => {
    findContactMatchesByEmailMock.mockReset();
    queueAmbiguousContactMatchMock.mockReset();
    linkExistingMatchedContactMock.mockReset();
    createContactForEntraUserMock.mockReset();
    resetPortalProvisioningMocks();
    previewLinkedContactChangeMock.mockReset();
    markDisabledEntraUsersInactiveMock.mockReset();
    selectLinkedEntraIdentitiesMock.mockReset();
    selectLinkedEntraIdentitiesMock.mockResolvedValue([]);
  });

  it('F8: a dry run counts the inactivations it would make and performs none', async () => {
    selectLinkedEntraIdentitiesMock.mockResolvedValue([
      { identity: disabled[0], linkedContactCount: 1 },
    ]);

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    const result = await executeEntraSync({
      tenantId: 'tenant-333',
      clientId: 'client-333',
      managedTenantId: 'managed-333',
      dryRun: true,
      users: [],
      disabledIdentities: disabled,
    });

    // The landmine: a preview that deactivates real contacts is worse than no
    // preview at all.
    expect(markDisabledEntraUsersInactiveMock).not.toHaveBeenCalled();
    expect(result.counters.inactivated).toBe(1);
    expect(result.preview).toEqual([
      expect.objectContaining({ bucket: 'mark_inactive', entraObjectId: 'entra-object-disabled' }),
    ]);
  });

  it('does not promise to inactivate a disabled account that has no contact here', async () => {
    // The account is disabled in Entra but was never synced into Alga, so there
    // is nothing to mark. Listing it under "Marked inactive" would tell the
    // operator a change is coming that the real run cannot make.
    selectLinkedEntraIdentitiesMock.mockResolvedValue([]);

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    const result = await executeEntraSync({
      tenantId: 'tenant-333',
      clientId: 'client-333',
      managedTenantId: 'managed-333',
      dryRun: true,
      users: [],
      disabledIdentities: disabled,
    });

    expect(result.counters.inactivated).toBe(0);
    expect(result.preview).toEqual([]);
  });

  it('a real run performs the inactivation and reports the same count', async () => {
    markDisabledEntraUsersInactiveMock.mockResolvedValue(1);

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    const result = await executeEntraSync({
      tenantId: 'tenant-333',
      clientId: 'client-333',
      managedTenantId: 'managed-333',
      users: [],
      disabledIdentities: disabled,
    });

    expect(markDisabledEntraUsersInactiveMock).toHaveBeenCalledWith('tenant-333', [
      { entraTenantId: 'entra-tenant-111', entraObjectId: 'entra-object-disabled' },
    ]);
    expect(selectLinkedEntraIdentitiesMock).not.toHaveBeenCalled();
    expect(result.counters.inactivated).toBe(1);
    expect(result.preview).toBeUndefined();
  });

  it('a preflight reports the counts the real run then reports on unchanged data', async () => {
    const users = [buildUser('created'), buildUser('linked')];
    const linkedMatch = [
      {
        contactNameId: 'contact-linked',
        clientId: 'client-444',
        email: 'linked@example.com',
        fullName: 'Linked User',
        isInactive: false,
      },
    ];

    findContactMatchesByEmailMock.mockImplementation(async (_tenant, _client, user) =>
      user.entraObjectId === 'entra-object-linked' ? linkedMatch : []
    );
    previewLinkedContactChangeMock.mockResolvedValue({ alreadyLinked: false, fieldsWouldChange: true });
    selectLinkedEntraIdentitiesMock.mockResolvedValue([
      { identity: disabled[0], linkedContactCount: 1 },
    ]);

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    const preview = await executeEntraSync({
      tenantId: 'tenant-444',
      clientId: 'client-444',
      managedTenantId: 'managed-444',
      dryRun: true,
      users,
      disabledIdentities: disabled,
    });

    linkExistingMatchedContactMock.mockResolvedValue({
      action: 'linked',
      fieldsUpdated: true,
      contactNameId: 'contact-linked',
      linkIdentity: { entraTenantId: 'entra-tenant-111', entraObjectId: 'entra-object-linked' },
    });
    createContactForEntraUserMock.mockResolvedValue({
      action: 'created',
      contactNameId: 'contact-created',
      linkIdentity: { entraTenantId: 'entra-tenant-111', entraObjectId: 'entra-object-created' },
    });
    markDisabledEntraUsersInactiveMock.mockResolvedValue(1);

    const real = await executeEntraSync({
      tenantId: 'tenant-444',
      clientId: 'client-444',
      managedTenantId: 'managed-444',
      users,
      disabledIdentities: disabled,
    });

    expect(preview.counters).toEqual(real.counters);
  });
});
