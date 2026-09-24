import { c4, email, fail } from './proxies';
import type { CreateTenantArgs, CreateTenantResult } from './types';

/**
 * Operator creates an appliance tenant on request. Mints the registry tenant
 * + install code in C4 and emails it. A paid edition without a subscription is
 * registered as Essentials and then handed a comp Pro key (`comp`), which the
 * customer pastes in after installing.
 */
export async function applianceCreateTenantWorkflow(args: CreateTenantArgs): Promise<CreateTenantResult> {
  const paid = args.edition !== 'essentials';
  if (paid && !args.stripeSubId && !args.comp) fail('A paid edition needs stripe_sub_id or comp', 'invalid_input');

  const registered = await c4.c4RegisterTenant({
    companyName: args.companyName,
    contactName: args.contactName,
    contactEmail: args.contactEmail,
    edition: args.comp ? 'essentials' : args.edition,
    productCode: args.productCode,
    seats: args.stripeSubId ? args.seats : null,
    stripeSubId: args.stripeSubId,
  });

  const installMail = await email.deliverApplianceEmail({
    kind: 'install-code',
    to: args.contactEmail,
    companyName: args.companyName,
    edition: args.comp ? 'essentials' : args.edition,
    installCode: registered.install_code,
    downloadUrl: registered.download_url || undefined,
  });

  const result: CreateTenantResult = {
    tenant_id: registered.tenant_id,
    install_code: registered.install_code,
    download_url: registered.download_url,
    expires_at: registered.expires_at,
    email_sent: installMail.sent,
  };

  if (args.comp) {
    const comp = await c4.c4GrantCompLicense({
      tenantId: registered.tenant_id,
      tier: args.edition === 'premium' ? 'premium' : 'pro',
      seats: args.seats,
      endsAt: args.comp.endsAt,
      note: args.comp.note,
    });
    const compMail = await email.deliverApplianceEmail({
      kind: 'comp-key',
      to: args.contactEmail,
      companyName: args.companyName,
      jwt: comp.jwt,
      expiresAt: comp.exp,
    });
    result.comp = { jwt: comp.jwt, exp: comp.exp, license_sub: comp.license_sub, email_sent: compMail.sent };
  }

  return result;
}
