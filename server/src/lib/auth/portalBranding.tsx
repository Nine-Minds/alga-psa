import { getTenantBrandingByDomain, type TenantBranding } from '@alga-psa/tenancy/actions';
import { generateBrandingStyles } from '@alga-psa/tenancy';

export type PortalSearchParams = Record<string, string | string[] | undefined>;

export function getPortalDomain(searchParams: PortalSearchParams): string | undefined {
  const portalDomain = searchParams.portalDomain;
  if (typeof portalDomain !== 'string' || !portalDomain.trim()) {
    return undefined;
  }

  return portalDomain.trim();
}

export async function getPortalBranding(searchParams: PortalSearchParams): Promise<TenantBranding | null> {
  const portalDomain = getPortalDomain(searchParams);
  return portalDomain ? getTenantBrandingByDomain(portalDomain) : null;
}

export function PortalBrandingStyles({ branding }: { branding: TenantBranding | null }) {
  if (!branding) {
    return null;
  }

  const brandingStyles = branding.computedStyles || generateBrandingStyles(branding);
  if (!brandingStyles) {
    return null;
  }

  return (
    <style
      id="server-tenant-branding-styles"
      dangerouslySetInnerHTML={{ __html: brandingStyles }}
    />
  );
}
