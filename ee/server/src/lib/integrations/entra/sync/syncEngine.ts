import type { EntraSyncUser } from './types';
import { EntraSyncResultAggregator } from './syncResultAggregator';
import { findContactMatchesByEmail } from './contactMatcher';
import {
  createContactForEntraUser,
  linkExistingMatchedContact,
  queueAmbiguousContactMatch,
} from './contactReconciler';
import {
  evaluateClientPortalProvisioningEligibility,
  handleEligibleClientPortalProvisioning,
  handleIneligibleClientPortalLifecycle,
} from './clientPortalProvisioning';
import { publishWorkflowManagedPortalProvisioningEvent } from './workflowManagedProvisioning';

export interface ExecuteEntraSyncInput {
  tenantId: string;
  clientId: string;
  managedTenantId: string | null;
  users: EntraSyncUser[];
  portalEntitlement?: {
    provisioningMode: 'disabled' | 'built_in' | 'workflow_managed';
    groupId: string | null;
    membershipMode: 'transitive';
    defaultRoleName?: string | null;
    workflowTarget?: string | null;
    workflowConfig?: Record<string, unknown> | null;
    deactivateOnEntitlementRemoval?: boolean;
  };
  syncRunId?: string;
  fieldSyncConfig?: Record<string, unknown>;
  dryRun?: boolean;
}

export interface ExecuteEntraSyncResult {
  dryRun: boolean;
  counters: {
    created: number;
    linked: number;
    updated: number;
    ambiguous: number;
    inactivated: number;
    skipped: number;
  };
}

export async function executeEntraSync(
  input: ExecuteEntraSyncInput
): Promise<ExecuteEntraSyncResult> {
  const dryRun = Boolean(input.dryRun);
  const counters = new EntraSyncResultAggregator();

  for (const user of input.users) {
    const userWithEntitlement: EntraSyncUser = input.portalEntitlement
      ? {
          ...user,
          clientPortalEntitlement: {
            groupId: input.portalEntitlement.groupId,
            membershipMode: input.portalEntitlement.membershipMode,
            isMember: user.clientPortalEntitlement?.isMember ?? null,
          },
        }
      : user;
    const candidates = await findContactMatchesByEmail(input.tenantId, input.clientId, userWithEntitlement);

    if (candidates.length > 1) {
      counters.increment('ambiguous');
      if (!dryRun) {
        await queueAmbiguousContactMatch(
          input.tenantId,
          input.clientId,
          input.managedTenantId,
          userWithEntitlement,
          candidates
        );
      }
      continue;
    }

    if (candidates.length === 1) {
      counters.increment('linked');
      if (!dryRun) {
        const linkedContact = await linkExistingMatchedContact(
          input.tenantId,
          input.clientId,
          candidates[0],
          userWithEntitlement,
          input.fieldSyncConfig
        );
        const eligibility = evaluateClientPortalProvisioningEligibility(
          userWithEntitlement,
          input.portalEntitlement
        );
        if (eligibility.eligible) {
          const provisioning = await handleEligibleClientPortalProvisioning(
            {
              tenantId: input.tenantId,
              clientId: input.clientId,
              managedTenantId: input.managedTenantId,
              contactNameId: linkedContact.contactNameId,
              defaultRoleName: input.portalEntitlement?.defaultRoleName || 'User',
            },
            userWithEntitlement
          );
          if (provisioning.outcome === 'skipped_conflict') {
            counters.increment('skipped');
          }
        } else if (eligibility.reason === 'workflow_managed') {
          await publishWorkflowManagedPortalProvisioningEvent(
            {
              tenantId: input.tenantId,
              clientId: input.clientId,
              managedTenantId: input.managedTenantId,
              contactNameId: linkedContact.contactNameId,
              defaultRoleName: input.portalEntitlement?.defaultRoleName || 'User',
              syncRunId: input.syncRunId,
              workflowTarget: input.portalEntitlement?.workflowTarget,
              workflowConfig: input.portalEntitlement?.workflowConfig || null,
            },
            userWithEntitlement
          );
        } else {
          const lifecycle = await handleIneligibleClientPortalLifecycle(
            {
              tenantId: input.tenantId,
              clientId: input.clientId,
              managedTenantId: input.managedTenantId,
              contactNameId: linkedContact.contactNameId,
              defaultRoleName: input.portalEntitlement?.defaultRoleName || 'User',
            },
            userWithEntitlement,
            eligibility,
            {
              deactivateOnEntitlementRemoval:
                input.portalEntitlement?.deactivateOnEntitlementRemoval,
            }
          );
          if (lifecycle.outcome === 'deactivated') {
            counters.increment('inactivated');
          }
        }
      }
      continue;
    }

    counters.increment('created');
    if (!dryRun) {
      const createdContact = await createContactForEntraUser(input.tenantId, input.clientId, userWithEntitlement);
      const eligibility = evaluateClientPortalProvisioningEligibility(
        userWithEntitlement,
        input.portalEntitlement
      );
      if (eligibility.eligible) {
        const provisioning = await handleEligibleClientPortalProvisioning(
          {
            tenantId: input.tenantId,
            clientId: input.clientId,
            managedTenantId: input.managedTenantId,
            contactNameId: createdContact.contactNameId,
            defaultRoleName: input.portalEntitlement?.defaultRoleName || 'User',
          },
          userWithEntitlement
        );
        if (provisioning.outcome === 'skipped_conflict') {
          counters.increment('skipped');
        }
      } else if (eligibility.reason === 'workflow_managed') {
        await publishWorkflowManagedPortalProvisioningEvent(
          {
            tenantId: input.tenantId,
            clientId: input.clientId,
            managedTenantId: input.managedTenantId,
            contactNameId: createdContact.contactNameId,
            defaultRoleName: input.portalEntitlement?.defaultRoleName || 'User',
            syncRunId: input.syncRunId,
            workflowTarget: input.portalEntitlement?.workflowTarget,
            workflowConfig: input.portalEntitlement?.workflowConfig || null,
          },
          userWithEntitlement
        );
      } else {
        const lifecycle = await handleIneligibleClientPortalLifecycle(
          {
            tenantId: input.tenantId,
            clientId: input.clientId,
            managedTenantId: input.managedTenantId,
            contactNameId: createdContact.contactNameId,
            defaultRoleName: input.portalEntitlement?.defaultRoleName || 'User',
          },
          userWithEntitlement,
          eligibility,
          {
            deactivateOnEntitlementRemoval:
              input.portalEntitlement?.deactivateOnEntitlementRemoval,
          }
        );
        if (lifecycle.outcome === 'deactivated') {
          counters.increment('inactivated');
        }
      }
    }
  }

  return {
    dryRun,
    counters: counters.toJSON(),
  };
}
