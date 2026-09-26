import { c4, email } from './proxies';
import type { ReissueInstallCodeArgs, ReissueInstallCodeResult } from './types';

/** Fresh install code for a reinstall; prior unclaimed codes are revoked by C4. */
export async function applianceReissueInstallCodeWorkflow(args: ReissueInstallCodeArgs): Promise<ReissueInstallCodeResult> {
  const detail = await c4.c4GetTenantDetail({ tenantId: args.tenantId });
  const issued = await c4.c4ReissueInstallCode({ tenantId: args.tenantId });
  const mail = await email.deliverApplianceEmail({
    kind: 'install-code',
    to: detail.tenant.contact_email,
    companyName: detail.tenant.company_name,
    edition: detail.tenant.edition,
    installCode: issued.install_code,
    downloadUrl: issued.download_url || undefined,
  });
  return {
    install_code: issued.install_code,
    download_url: issued.download_url,
    expires_at: issued.expires_at,
    email_sent: mail.sent,
  };
}
