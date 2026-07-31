import type { EntraSyncUser } from './types';
import { EntraSyncResultAggregator } from './syncResultAggregator';
import { findContactMatchesByEmail } from './contactMatcher';
import {
  createContactForEntraUser,
  linkExistingMatchedContact,
  previewLinkedContactChange,
  queueAmbiguousContactMatch,
} from './contactReconciler';
import {
  evaluateClientPortalProvisioningEligibility,
  handleEligibleClientPortalProvisioning,
  handleIneligibleClientPortalLifecycle,
} from './clientPortalProvisioning';
import { publishWorkflowManagedPortalProvisioningEvent } from './workflowManagedProvisioning';
import {
  markDisabledEntraUsersInactive,
  selectLinkedEntraIdentities,
  type EntraIdentityRef,
} from './disableHandler';

/** What the sync would do to one identity, in the operator's terms. */
export type EntraSyncPreviewBucket =
  | 'create'
  | 'link'
  | 'needs_decision'
  | 'no_change'
  | 'mark_inactive';

export interface EntraSyncPreviewIdentity {
  bucket: EntraSyncPreviewBucket;
  entraObjectId: string;
  displayName: string | null;
  email: string | null;
  userPrincipalName: string | null;
}

export interface EntraDisabledIdentityInput extends EntraIdentityRef {
  displayName?: string | null;
  email?: string | null;
  userPrincipalName?: string | null;
}

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
  /**
   * Identities the provider reported as disabled upstream. Handled here rather
   * than by the caller so the dry-run guard is total: F8 was a real preview
   * that deactivated real contacts because inactivation ran outside this
   * function and outside the flag.
   */
  disabledIdentities?: EntraDisabledIdentityInput[];
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
  /** Per-identity classification. Only collected on a dry run. */
  preview?: EntraSyncPreviewIdentity[];
}

function isInactivationEnabled(config: Record<string, unknown> | undefined): boolean {
  const value = config?.markInactiveWhenDisabled ?? config?.mark_inactive_when_disabled;
  // Absent means the setting predates the toggle, where inactivation was
  // unconditional; preserve that rather than silently changing behaviour.
  if (value === undefined || value === null) {
    return true;
  }
  return value === true || value === 'true' || value === 1 || value === '1';
}

function describeUser(
  user: EntraSyncUser,
  bucket: EntraSyncPreviewBucket
): EntraSyncPreviewIdentity {
  return {
    bucket,
    entraObjectId: user.entraObjectId,
    displayName: user.displayName,
    email: user.email,
    userPrincipalName: user.userPrincipalName,
  };
}

export async function executeEntraSync(
  input: ExecuteEntraSyncInput
): Promise<ExecuteEntraSyncResult> {
  const dryRun = Boolean(input.dryRun);
  const counters = new EntraSyncResultAggregator();
  const preview: EntraSyncPreviewIdentity[] | undefined = dryRun ? [] : undefined;

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
      if (dryRun) {
        preview?.push(describeUser(user, 'needs_decision'));
      } else {
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
      if (dryRun) {
        // The preview answers "would this change anything?" with the same rule
        // the real run applies, so the counts match on unchanged data.
        const outcome = await previewLinkedContactChange(
          input.tenantId,
          candidates[0],
          user,
          input.fieldSyncConfig
        );
        if (outcome.fieldsWouldChange) {
          counters.increment('updated');
        }
        preview?.push(
          describeUser(
            user,
            outcome.alreadyLinked && !outcome.fieldsWouldChange ? 'no_change' : 'link'
          )
        );
      } else {
        const linkedContact = await linkExistingMatchedContact(
          input.tenantId,
          input.clientId,
          candidates[0],
          userWithEntitlement,
          input.fieldSyncConfig
        );
        // `updated` counts contacts whose values the field-sync rules actually
        // changed. A link that overwrote nothing is a link and nothing more.
        if (linkedContact.fieldsUpdated) {
          counters.increment('updated');
        }
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
    if (dryRun) {
      preview?.push(describeUser(user, 'create'));
    } else {
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

  // The inactivation rule is a field-sync rule like any other: an operator who
  // turned it off must not have contacts deactivated behind their back.
  const inactivationEnabled = isInactivationEnabled(input.fieldSyncConfig);
  const disabledIdentities = inactivationEnabled ? input.disabledIdentities || [] : [];
  if (disabledIdentities.length > 0) {
    if (dryRun) {
      // Only identities with a contact behind them: a disabled account that was
      // never synced here has nothing to mark, and listing it would promise a
      // change the run cannot make.
      const linked = await selectLinkedEntraIdentities(input.tenantId, disabledIdentities);
      for (const entry of linked) {
        for (let index = 0; index < entry.linkedContactCount; index += 1) {
          counters.increment('inactivated');
        }
        preview?.push({
          bucket: 'mark_inactive',
          entraObjectId: entry.identity.entraObjectId,
          displayName: entry.identity.displayName ?? null,
          email: entry.identity.email ?? null,
          userPrincipalName: entry.identity.userPrincipalName ?? null,
        });
      }
    } else {
      const inactivated = await markDisabledEntraUsersInactive(
        input.tenantId,
        disabledIdentities.map((identity) => ({
          entraTenantId: identity.entraTenantId,
          entraObjectId: identity.entraObjectId,
        }))
      );
      for (let index = 0; index < inactivated; index += 1) {
        counters.increment('inactivated');
      }
    }
  }

  return {
    dryRun,
    counters: counters.toJSON(),
    ...(preview ? { preview } : {}),
  };
}
