import { c4, email, fail } from './proxies';
import type { AirgapKeyArgs, AirgapKeyResult } from './types';

/** Re-sign the offline license key bound to the tenant and email it. */
export async function applianceAirgapKeyWorkflow(args: AirgapKeyArgs): Promise<AirgapKeyResult> {
  const detail = await c4.c4GetTenantDetail({ tenantId: args.tenantId });
  if (!detail.entitlement?.active) fail('Tenant has no active entitlement to sign', 'no_active_entitlement');
  const signed = await c4.c4SignAirgapKey({ tenantId: args.tenantId });
  const mail = await email.deliverApplianceEmail({
    kind: 'airgap-key',
    to: detail.tenant.contact_email,
    companyName: detail.tenant.company_name,
    jwt: signed.jwt,
    expiresAt: signed.exp,
  });
  return { jwt: signed.jwt, exp: signed.exp, email_sent: mail.sent };
}
