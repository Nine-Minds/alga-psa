import { Suspense } from 'react';
import { I18nWrapper } from '@alga-psa/tenancy/components';
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
  const { t } = await getServerTranslation(undefined, 'common');

  return (
    <Suspense fallback={<div>{t('status.loading', { defaultValue: 'Loading...' })}</div>}>
      <I18nWrapper portal={isClientPortal ? 'client' : 'msp'}>
        <PortalBrandingStyles branding={branding} />
        <CheckEmailClient branding={branding} portalDomain={portalDomain} />
      </I18nWrapper>
    </Suspense>
  );
}
