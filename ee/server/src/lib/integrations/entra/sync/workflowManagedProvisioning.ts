// Imported from the package rather than server/src: this module is pulled into
// the Temporal worker bundle, and the server-side publisher barrel drags in
// @alga-psa/notifications, whose exports resolve to .ts sources that plain Node
// cannot load from the built worker.
import { publishUnregisteredEventType } from '@alga-psa/event-bus/publishers';
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

  // KNOWN DEFECT alga-2026-0002675: ENTRA_PORTAL_ACCESS_ELIGIBLE / _REMOVED are not in EVENT_TYPES,
  // so the transport rejects this publish and the sync path throws. Behaviour is unchanged here
  // (the old by-name publisher threw "Unknown event type"); the envelope is stamped inline because
  // there is no workflow-catalog entry for publishWorkflowEvent to validate against.
  await publishUnregisteredEventType({
    eventType,
    payload: {
      occurredAt: new Date().toISOString(),
      actorType: 'SYSTEM',
      idempotencyKey,
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
  });

  return eventType;
}
