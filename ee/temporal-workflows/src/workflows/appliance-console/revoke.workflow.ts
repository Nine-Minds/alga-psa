import { c4, fail } from './proxies';
import type { RevokeArgs, RevokeResult } from './types';

/**
 * Soft revoke: the entitlement stops being served at check-in and the
 * appliance grace-expires on its held token. Hard additionally revokes every
 * live appliance credential so the next check-in is refused outright and the
 * customer must re-activate with a new code.
 */
export async function applianceRevokeWorkflow(args: RevokeArgs): Promise<RevokeResult> {
  const detail = await c4.c4GetTenantDetail({ tenantId: args.tenantId });
  const ent = detail.entitlement;
  if (!ent) fail('Tenant has no entitlement to revoke', 'no_entitlement');

  await c4.c4RevokeEntitlement({ stripeSubId: ent.stripe_sub_id });

  let appliancesRevoked = 0;
  if (args.hard) {
    for (const appliance of detail.appliances) {
      if (appliance.credential_revoked) continue;
      await c4.c4RevokeAppliance({ tenantId: args.tenantId, applianceId: appliance.appliance_id, reason: args.reason });
      appliancesRevoked += 1;
    }
  }

  return { revoked: true, hard: args.hard, appliances_revoked: appliancesRevoked };
}
