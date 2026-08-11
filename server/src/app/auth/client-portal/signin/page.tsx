import { redirect } from 'next/navigation';
import { ClientPortalSignIn, PortalSwitchPrompt } from '@alga-psa/auth/client';
import { ClientPortalTenantDiscovery } from '@alga-psa/client-portal/components';
import { I18nWrapper } from '@alga-psa/tenancy/components';
import { getTenantBrandingByDomain, getTenantLocaleByDomain, getTenantLocaleBySlug } from '@alga-psa/tenancy/actions';
import { getSession } from '@alga-psa/auth';
import { isValidTenantSlug } from '@shared/utils/tenantSlug';
import { UserSession } from '@alga-psa/db/models/UserSession';
import { recordPortalDomainSeen } from '@/lib/portal-domains/portalDomainSeen';
import type { Metadata } from 'next';
import { getServerLocale, getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { PortalBrandingStyles } from '@/lib/auth/portalBranding';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('auth.clientPortal.signin.title', { defaultValue: 'Client Portal Sign In' }),
  };
}

export default async function ClientSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const callbackUrl = typeof params?.callbackUrl === 'string' ? params.callbackUrl : '/client-portal/dashboard';

  // Get portalDomain from query parameter (set by middleware for vanity domains)
  const portalDomain = typeof params?.portalDomain === 'string' ? params.portalDomain : null;

  // Reaching this page with a portalDomain proves a request arrived bearing that
  // vanity Host (i.e. the operator's proxy forwarded it). Record it best-effort so
  // Settings can warn when an active appliance domain is never actually reachable.
  if (portalDomain) {
    void recordPortalDomainSeen(portalDomain);
  }

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

        // Same trap the tenant-discovery branch fell into: returned outside any
        // provider, this interstitial rendered English at every locale.
        const switchLocale = await getServerLocale();
        return (
          <I18nWrapper portal="client" initialLocale={switchLocale}>
            <PortalSwitchPrompt
              currentPortal="msp"
              targetPortal="client"
              currentPortalUrl="/msp/dashboard"
              targetPortalSigninUrl={targetUrl}
              userEmail={session.user.email}
            />
          </I18nWrapper>
        );
      } else {
        // Valid session, not revoked, correct user type - redirect
        return redirect(callbackUrl);
      }
    }
  }

  // If no tenant slug and no vanity domain, show tenant discovery form. There is
  // no tenant to resolve a locale from here, so fall back to the anonymous
  // resolution the MSP sign-in page uses.
  if (!tenantSlug && !portalDomain) {
    const discoveryLocale = await getServerLocale();
    return (
      <I18nWrapper portal="client" initialLocale={discoveryLocale}>
        <ClientPortalTenantDiscovery callbackUrl={callbackUrl} />
      </I18nWrapper>
    );
  }

  // Fetch tenant branding and locale based on portalDomain (if present).
  // Without a vanity host the tenant is still known — the `?tenant=` slug names
  // it — so the portal language resolves from that instead. Otherwise a tenant
  // with no custom domain gets English regardless of what it configured.
  const [branding, locale] = portalDomain
    ? await Promise.all([
        getTenantBrandingByDomain(portalDomain),
        getTenantLocaleByDomain(portalDomain),
      ])
    : [null, tenantSlug ? await getTenantLocaleBySlug(tenantSlug) : null];

  return (
    <I18nWrapper portal="client" initialLocale={locale || undefined}>
      <PortalBrandingStyles branding={branding} />
      <ClientPortalSignIn branding={branding} portalDomain={portalDomain || undefined} />
    </I18nWrapper>
  );
}
