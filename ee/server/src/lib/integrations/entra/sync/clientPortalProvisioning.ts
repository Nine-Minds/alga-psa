import type { EntraSyncUser } from './types';

export interface ClientPortalProvisioningContext {
  tenantId: string;
  clientId: string;
  managedTenantId: string | null;
}

export interface ClientPortalProvisioningConfig {
  provisioningMode: 'disabled' | 'built_in' | 'workflow_managed';
  groupId: string | null;
  membershipMode: 'transitive' | 'direct';
}

export interface ClientPortalProvisioningEligibility {
  eligible: boolean;
  reason:
    | 'eligible'
    | 'mode_disabled'
    | 'missing_group'
    | 'missing_identity'
    | 'account_disabled'
    | 'missing_entitlement';
}

export function evaluateClientPortalProvisioningEligibility(
  user: EntraSyncUser,
  config: ClientPortalProvisioningConfig | undefined
): ClientPortalProvisioningEligibility {
  if (!config || config.provisioningMode === 'disabled') {
    return { eligible: false, reason: 'mode_disabled' };
  }
  if (!config.groupId) {
    return { eligible: false, reason: 'missing_group' };
  }
  if (!user.email && !user.userPrincipalName) {
    return { eligible: false, reason: 'missing_identity' };
  }
  if (!user.accountEnabled) {
    return { eligible: false, reason: 'account_disabled' };
  }
  if (user.clientPortalEntitlement?.isMember !== true) {
    return { eligible: false, reason: 'missing_entitlement' };
  }
  return { eligible: true, reason: 'eligible' };
}

export async function handleEligibleClientPortalProvisioning(
  _context: ClientPortalProvisioningContext,
  _user: EntraSyncUser
): Promise<void> {
  // Provisioning mutations are implemented in later plan items.
}
