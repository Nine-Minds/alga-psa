import { c4, email, fail } from './proxies';
import type { ReissueActivationCodeArgs, ReissueActivationCodeResult } from './types';

/** Fresh in-app activation code (rebind: prior appliance credentials are revoked by C4). */
export async function applianceReissueActivationCodeWorkflow(
  args: ReissueActivationCodeArgs,
): Promise<ReissueActivationCodeResult> {
  const detail = await c4.c4GetTenantDetail({ tenantId: args.tenantId });
  if (!detail.entitlement?.active) fail('Tenant has no active entitlement to activate', 'no_active_entitlement');
  const minted = await c4.c4MintActivationCode({ tenantId: args.tenantId });
  const mail = await email.deliverApplianceEmail({
    kind: 'activation-code',
    to: detail.tenant.contact_email,
    companyName: detail.tenant.company_name,
    activationCode: minted.code,
    expiresAt: minted.expires_at,
  });
  return { code: minted.code, expires_at: minted.expires_at, email_sent: mail.sent };
}
