import { Suspense } from 'react';
import { I18nWrapper } from '@alga-psa/tenancy/components';
import { getTenantLocaleByDomain } from '@alga-psa/tenancy/actions';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import CheckEmailClient from './CheckEmailClient';
import { getPortalBranding, getPortalDomain, PortalBrandingStyles, type PortalSearchParams } from '@/lib/auth/portalBranding';

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<PortalSearchParams>;
}) {
  const params = await searchParams;
  const isClientPortal = params.portal === 'client';
  const branding = isClientPortal ? await getPortalBranding(params) : null;
  const portalDomain = isClientPortal ? getPortalDomain(params) : undefined;
  // Pre-login there is no user, so the hierarchical resolver can only answer
  // with the system default. On a vanity domain the tenant is knowable from the
  // host, which is the one signal that makes this page follow the customer's
  // configured language — same resolution the client-portal sign-in page uses.
  const locale = portalDomain ? await getTenantLocaleByDomain(portalDomain) : null;
  const { t } = await getServerTranslation(undefined, 'common');

  return (
    <Suspense fallback={<div>{t('status.loading', { defaultValue: 'Loading...' })}</div>}>
      <I18nWrapper portal={isClientPortal ? 'client' : 'msp'} initialLocale={locale || undefined}>
        <PortalBrandingStyles branding={branding} />
        <CheckEmailClient branding={branding} portalDomain={portalDomain} />
      </I18nWrapper>
    </Suspense>
  );
}
