import { Suspense } from 'react';
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

  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PortalBrandingStyles branding={branding} />
      <SetNewPasswordClient branding={branding} portalDomain={portalDomain} />
    </Suspense>
  );
}
