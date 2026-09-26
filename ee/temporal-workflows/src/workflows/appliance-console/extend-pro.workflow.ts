import { c4, email, fail } from './proxies';
import type { ExtendProArgs, ExtendProResult } from './types';

/**
 * "Extend the trial": a time-boxed comp Pro key signed by C4 and pasted into
 * Settings → License. No Stripe involvement; the customer buys through the
 * portal whenever they are ready and that activation code replaces this key.
 */
export async function applianceExtendProWorkflow(args: ExtendProArgs): Promise<ExtendProResult> {
  const detail = await c4.c4GetTenantDetail({ tenantId: args.tenantId });
  if (detail.entitlement?.active && detail.entitlement.kind === 'stripe') {
    fail('Tenant already has an active paid subscription; use a billing action instead', 'has_stripe_entitlement');
  }
  const granted = await c4.c4GrantCompLicense({
    tenantId: args.tenantId,
    seats: args.seats,
    endsAt: args.endsAt,
    note: args.reason ?? 'Extended by operator',
  });
  const mail = await email.deliverApplianceEmail({
    kind: 'comp-key',
    to: detail.tenant.contact_email,
    companyName: detail.tenant.company_name,
    jwt: granted.jwt,
    expiresAt: granted.exp,
  });
  return { jwt: granted.jwt, exp: granted.exp, license_sub: granted.license_sub, email_sent: mail.sent };
}
