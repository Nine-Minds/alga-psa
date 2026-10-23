import { c4, fail } from './proxies';
import type { RevokeApplianceArgs, RevokeApplianceResult } from './types';

/**
 * Hard-revoke one appliance credential (lost box, suspected compromise). The
 * entitlement stays active; the customer re-activates a replacement appliance
 * with a fresh activation code.
 */
export async function applianceRevokeApplianceWorkflow(args: RevokeApplianceArgs): Promise<RevokeApplianceResult> {
  const detail = await c4.c4GetTenantDetail({ tenantId: args.tenantId });
  const appliance = detail.appliances.find((a) => a.appliance_id === args.applianceId);
  if (!appliance) fail(`No appliance ${args.applianceId} on this tenant`, 'appliance_not_found');
  if (!appliance.credential_revoked) {
    await c4.c4RevokeAppliance({ tenantId: args.tenantId, applianceId: args.applianceId, reason: args.reason });
  }
  return { appliance_id: args.applianceId, revoked: true };
}
