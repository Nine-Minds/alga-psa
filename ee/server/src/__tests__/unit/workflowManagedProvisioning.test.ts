import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { EntraSyncUser } from '@ee/lib/integrations/entra/sync/types';

const publishWorkflowEventMock = vi.fn();

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishWorkflowEvent: publishWorkflowEventMock,
}));

function buildUser(overrides: Partial<EntraSyncUser> = {}): EntraSyncUser {
  return {
    entraTenantId: 'entra-tenant-301',
    entraObjectId: 'entra-object-301',
    userPrincipalName: 'user301@example.com',
    email: 'user301@example.com',
    displayName: 'User 301',
    givenName: 'User',
    surname: 'ThreeZeroOne',
    accountEnabled: true,
    jobTitle: null,
    mobilePhone: null,
    businessPhones: [],
    raw: {},
    clientPortalEntitlement: {
      groupId: 'group-301',
      membershipMode: 'transitive',
      isMember: true,
    },
    ...overrides,
  };
}

describe('workflow-managed Entra portal provisioning events', () => {
  beforeEach(() => {
    vi.resetModules();
    publishWorkflowEventMock.mockReset();
    publishWorkflowEventMock.mockResolvedValue(undefined);
  });

  it('publishes idempotent eligible event payload with required provisioning context', async () => {
    const { publishWorkflowManagedPortalProvisioningEvent } = await import('@ee/lib/integrations/entra/sync/workflowManagedProvisioning');
    const eventType = await publishWorkflowManagedPortalProvisioningEvent(
      {
        tenantId: 'tenant-301',
        clientId: 'client-301',
        managedTenantId: 'managed-301',
        contactNameId: 'contact-301',
        defaultRoleName: 'User',
        syncRunId: 'run-301',
        workflowTarget: 'workflow-301',
        workflowConfig: { mode: 'managed' },
      },
      buildUser()
    );

    expect(eventType).toBe('ENTRA_PORTAL_ACCESS_ELIGIBLE');
    expect(publishWorkflowEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'ENTRA_PORTAL_ACCESS_ELIGIBLE',
        idempotencyKey: 'entra_portal_access:tenant-301:managed-301:entra-tenant-301:entra-object-301:group-301:eligible',
        payload: expect.objectContaining({
          tenantId: 'tenant-301',
          clientId: 'client-301',
          contactNameId: 'contact-301',
          syncRunId: 'run-301',
          recommendedDefaultRole: 'User',
          workflowTarget: 'workflow-301',
          entitlement: expect.objectContaining({
            groupId: 'group-301',
            isMember: true,
          }),
        }),
      })
    );
  });

  it('publishes removed event for ineligible workflow-managed identities', async () => {
    const { publishWorkflowManagedPortalProvisioningEvent } = await import('@ee/lib/integrations/entra/sync/workflowManagedProvisioning');
    const eventType = await publishWorkflowManagedPortalProvisioningEvent(
      {
        tenantId: 'tenant-302',
        clientId: 'client-302',
        managedTenantId: 'managed-302',
        contactNameId: 'contact-302',
        defaultRoleName: 'User',
        syncRunId: 'run-302',
      },
      buildUser({
        accountEnabled: false,
        clientPortalEntitlement: {
          groupId: 'group-302',
          membershipMode: 'transitive',
          isMember: false,
        },
      })
    );

    expect(eventType).toBe('ENTRA_PORTAL_ACCESS_REMOVED');
    expect(publishWorkflowEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'ENTRA_PORTAL_ACCESS_REMOVED' })
    );
  });
});
