import { Suspense } from 'react';
import { I18nWrapper } from '@alga-psa/tenancy/components';
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

  return (
    <Suspense fallback={<div>Loading...</div>}>
      <I18nWrapper portal="client">
        <PortalBrandingStyles branding={branding} />
        <CheckEmailClient branding={branding} portalDomain={portalDomain} />
      </I18nWrapper>
    </Suspense>
  );
}
