import { c4, email } from './proxies';
import type { SetStatusArgs, SetStatusResult } from './types';

/**
 * Registry lifecycle. Suspend is soft: C4 stops rolling tokens at the next
 * check-in and the appliance lapses when its held token expires (≤31 days).
 * Cancelled also revokes the entitlement inside C4.
 */
export async function applianceSetStatusWorkflow(args: SetStatusArgs): Promise<SetStatusResult> {
  const detail = await c4.c4GetTenantDetail({ tenantId: args.tenantId });
  const previous = detail.tenant.status;
  await c4.c4SetTenantStatus({ tenantId: args.tenantId, status: args.status, reason: args.reason });

  let emailSent = false;
  if (args.status === 'suspended' && previous !== 'suspended') {
    const mail = await email.deliverApplianceEmail({
      kind: 'suspended',
      to: detail.tenant.contact_email,
      companyName: detail.tenant.company_name,
      reason: args.reason,
    });
    emailSent = mail.sent;
  } else if (args.status === 'active' && previous === 'suspended') {
    const mail = await email.deliverApplianceEmail({
      kind: 'reactivated',
      to: detail.tenant.contact_email,
      companyName: detail.tenant.company_name,
    });
    emailSent = mail.sent;
  }

  return { status: args.status, email_sent: emailSent };
}
