import { publishWorkflowEvent } from 'server/src/lib/eventBus/publishers';
import type { EntraSyncUser } from './types';

export type WorkflowManagedPortalEventType =
  | 'ENTRA_PORTAL_ACCESS_ELIGIBLE'
  | 'ENTRA_PORTAL_ACCESS_REMOVED';

export interface WorkflowManagedPortalProvisioningContext {
  tenantId: string;
  clientId: string;
  managedTenantId: string | null;
  contactNameId: string;
  defaultRoleName: string;
  syncRunId?: string;
  workflowTarget?: string | null;
  workflowConfig?: Record<string, unknown> | null;
}

export async function publishWorkflowManagedPortalProvisioningEvent(
  context: WorkflowManagedPortalProvisioningContext,
  user: EntraSyncUser
): Promise<WorkflowManagedPortalEventType | null> {
  const hasIdentity = Boolean(user.email || user.userPrincipalName);
  const hasGroup = Boolean(user.clientPortalEntitlement?.groupId);
  if (!hasIdentity || !hasGroup) {
    return null;
  }

  const entitled = Boolean(user.accountEnabled) && user.clientPortalEntitlement?.isMember === true;
  const eventType: WorkflowManagedPortalEventType = entitled
    ? 'ENTRA_PORTAL_ACCESS_ELIGIBLE'
    : 'ENTRA_PORTAL_ACCESS_REMOVED';

  const idempotencyKey = [
    'entra_portal_access',
    context.tenantId,
    context.managedTenantId || 'none',
    user.entraTenantId,
    user.entraObjectId,
    user.clientPortalEntitlement?.groupId || 'none',
    entitled ? 'eligible' : user.accountEnabled ? 'removed_entitlement' : 'removed_disabled',
  ].join(':');

  await publishWorkflowEvent({
    eventType,
    payload: {
      tenantId: context.tenantId,
      clientId: context.clientId,
      contactNameId: context.contactNameId,
      managedTenantId: context.managedTenantId,
      syncRunId: context.syncRunId || null,
      workflowTarget: context.workflowTarget || null,
      workflowConfig: context.workflowConfig || null,
      recommendedDefaultRole: context.defaultRoleName || 'User',
      entra: {
        tenantId: user.entraTenantId,
        objectId: user.entraObjectId,
        accountEnabled: user.accountEnabled,
        email: user.email,
        userPrincipalName: user.userPrincipalName,
      },
      entitlement: {
        sourceType: 'group',
        groupId: user.clientPortalEntitlement?.groupId || null,
        membershipMode: user.clientPortalEntitlement?.membershipMode || 'transitive',
        isMember: user.clientPortalEntitlement?.isMember ?? null,
      },
    },
    ctx: {
      tenantId: context.tenantId,
      actor: { actorType: 'SYSTEM' },
      correlationId: context.syncRunId || undefined,
    },
    idempotencyKey,
  });

  return eventType;
}
