import { Suspense } from 'react';
import { I18nWrapper } from '@alga-psa/tenancy/components';
import { getTenantLocaleByDomain } from '@alga-psa/tenancy/actions';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import SetNewPasswordClient from './SetNewPasswordClient';
import { getPortalBranding, getPortalDomain, PortalBrandingStyles, type PortalSearchParams } from '@/lib/auth/portalBranding';

export default async function SetNewPasswordPage({
  searchParams,
}: {
  searchParams: Promise<PortalSearchParams>;
}) {
  const params = await searchParams;
  const isClientPortal = params.portal === 'client';
  const branding = isClientPortal ? await getPortalBranding(params) : null;
  const portalDomain = isClientPortal ? getPortalDomain(params) : undefined;
  // Pre-login the tenant is only knowable from the vanity domain; the
  // hierarchical resolver has no user to resolve against.
  const locale = portalDomain ? await getTenantLocaleByDomain(portalDomain) : null;
  const { t } = await getServerTranslation(undefined, 'common');

  // SetNewPasswordClient calls useTranslation('msp/auth'); without a provider
  // above it, i18next is never initialised on a cold load of this route and
  // every key falls through to its English default.
  return (
    <Suspense fallback={<div>{t('status.loading', { defaultValue: 'Loading...' })}</div>}>
      <I18nWrapper portal={isClientPortal ? 'client' : 'msp'} initialLocale={locale || undefined}>
        <PortalBrandingStyles branding={branding} />
        <SetNewPasswordClient branding={branding} portalDomain={portalDomain} />
      </I18nWrapper>
    </Suspense>
  );
}
