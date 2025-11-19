import { redirect } from 'next/navigation';
import ClientPortalSignIn from 'server/src/components/auth/ClientPortalSignIn';
import ClientPortalTenantDiscovery from 'server/src/components/auth/ClientPortalTenantDiscovery';
import PortalSwitchPrompt from 'server/src/components/auth/PortalSwitchPrompt';
import { I18nWrapper } from 'server/src/components/i18n/I18nWrapper';
import { getTenantBrandingByDomain, getTenantLocaleByDomain } from 'server/src/lib/actions/tenant-actions/getTenantBrandingByDomain';
import { getSession } from 'server/src/lib/auth/getSession';
import { isValidTenantSlug } from '@shared/utils/tenantSlug';

export default async function ClientSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const callbackUrl = typeof params?.callbackUrl === 'string' ? params.callbackUrl : '/client-portal/dashboard';

  // Get portalDomain from query parameter (set by middleware for vanity domains)
  const portalDomain = typeof params?.portalDomain === 'string' ? params.portalDomain : null;

  // Get tenant slug from query parameter
  const tenantParam = typeof params?.tenant === 'string' ? params.tenant : '';
  const tenantSlug = isValidTenantSlug(tenantParam) ? tenantParam.toLowerCase() : undefined;

  const session = await getSession();
  if (session?.user) {
    if (session.user.user_type === 'internal') {
      // MSP user trying to access client portal - show portal switch prompt
      // Preserve the tenant information from the URL (either portalDomain or tenant slug)
      const queryParams = new URLSearchParams();
      if (portalDomain) {
        queryParams.set('portalDomain', portalDomain);
      }
      if (tenantSlug) {
        queryParams.set('tenant', tenantSlug);
      }

      const targetUrl = queryParams.toString()
        ? `/auth/client-portal/signin?${queryParams.toString()}`
        : '/auth/client-portal/signin';

      return (
        <PortalSwitchPrompt
          currentPortal="msp"
          targetPortal="client"
          currentPortalUrl="/msp/dashboard"
          targetPortalSigninUrl={targetUrl}
          userEmail={session.user.email}
        />
      );
    }

    return redirect(callbackUrl);
  }

  // If no tenant slug and no vanity domain, show tenant discovery form
  if (!tenantSlug && !portalDomain) {
    return <ClientPortalTenantDiscovery callbackUrl={callbackUrl} />;
  }

  // Fetch tenant branding and locale based on portalDomain (if present)
  const [branding, locale] = portalDomain
    ? await Promise.all([
        getTenantBrandingByDomain(portalDomain),
        getTenantLocaleByDomain(portalDomain),
      ])
    : [null, null];

  return (
    <I18nWrapper portal="client" initialLocale={locale || undefined}>
      <ClientPortalSignIn branding={branding} />
    </I18nWrapper>
  );
}
