import { redirect } from 'next/navigation';
import { ClientPortalSignIn, ClientPortalTenantDiscovery, PortalSwitchPrompt } from '@alga-psa/auth/client';
import { I18nWrapper } from '@alga-psa/ui/lib/i18n/I18nWrapper';
import { getTenantBrandingByDomain, getTenantLocaleByDomain } from '@alga-psa/tenancy/actions';
import { getSession } from '@alga-psa/auth';
import { isValidTenantSlug } from '@shared/utils/tenantSlug';
import { UserSession } from '@alga-psa/db/models/UserSession';

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
    // Verify session hasn't been revoked before redirecting
    const sessionId = (session as any).session_id;
    if (sessionId && session.user.tenant) {
      const isRevoked = await UserSession.isRevoked(session.user.tenant, sessionId);
      if (isRevoked) {
        // Session was revoked, continue to show signin form (don't return early yet)
        // We need to continue to check tenant slug/portal domain logic below
      } else if (session.user.user_type === 'internal') {
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
      } else {
        // Valid session, not revoked, correct user type - redirect
        return redirect(callbackUrl);
      }
    }
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
