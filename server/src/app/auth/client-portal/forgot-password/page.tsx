import { I18nWrapper } from '@alga-psa/tenancy/components';
import { getTenantLocaleByDomain } from '@alga-psa/tenancy/actions';
import ClientPortalForgotPassword from './ClientPortalForgotPassword';
import { getPortalBranding, getPortalDomain, PortalBrandingStyles, type PortalSearchParams } from '@/lib/auth/portalBranding';

export default async function ClientPortalForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<PortalSearchParams>;
}) {
  const params = await searchParams;
  const branding = await getPortalBranding(params);
  const portalDomain = getPortalDomain(params);
  // Pre-login the tenant is only knowable from the vanity domain; without this
  // the wrapper falls back to the system default and the page renders English
  // next to a sign-in page that honoured the tenant's language.
  const locale = portalDomain ? await getTenantLocaleByDomain(portalDomain) : null;

  return (
    <I18nWrapper portal="client" initialLocale={locale || undefined}>
      <PortalBrandingStyles branding={branding} />
      <ClientPortalForgotPassword branding={branding} portalDomain={portalDomain} />
    </I18nWrapper>
  );
}
