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

  return (
    <>
      <PortalBrandingStyles branding={branding} />
      <ClientPortalForgotPassword branding={branding} portalDomain={portalDomain} />
    </>
  );
}
