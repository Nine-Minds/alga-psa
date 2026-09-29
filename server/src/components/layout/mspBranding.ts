// The client portal side panel picks its logo variant the same way, so the
// colour maths lives in @alga-psa/ui and both shells read it from there.
export { isLightSurface, pickLogoForSurface, surfaceLuminance } from '@alga-psa/ui/lib/surfaceColor';

export interface MspBranding {
  /** Tenant logo for light surfaces; null keeps the stock Alga mark. */
  logoUrl: string | null;
  /** Optional logo for dark surfaces; falls back to logoUrl. */
  logoDarkUrl: string | null;
  /**
   * Optional landscape wordmark for the expanded rail. It carries the tenant
   * name itself, so the rail drops its own name span when one is present.
   */
  logoWideUrl: string | null;
  /** Wide wordmark for dark surfaces; falls back to logoWideUrl. */
  logoWideDarkUrl: string | null;
  /** Tenant display name shown next to the logo. */
  displayName: string | null;
}

export const EMPTY_MSP_BRANDING: MspBranding = {
  logoUrl: null,
  logoDarkUrl: null,
  logoWideUrl: null,
  logoWideDarkUrl: null,
  displayName: null,
};

interface TenantLogoSource {
  logoUrl?: string;
  logoDarkUrl?: string;
  logoWideUrl?: string;
  logoWideDarkUrl?: string;
  clientName?: string;
}

/**
 * Resolves the mark the MSP shell wears. Portal logo uploads are shared storage,
 * not permission to customize the staff app: Enterprise tenants must explicitly
 * enable MSP white-labeling before either logo can replace the stock Alga mark.
 */
export function resolveMspBranding(
  branding: TenantLogoSource | null | undefined,
  options: { isEnterprise: boolean; mspWhiteLabel: boolean },
): MspBranding | null {
  if (!options.isEnterprise || !options.mspWhiteLabel || !branding) {
    return null;
  }

  const logoUrl = branding.logoUrl || null;
  const logoDarkUrl = branding.logoDarkUrl || null;
  const logoWideUrl = branding.logoWideUrl || null;
  const logoWideDarkUrl = branding.logoWideDarkUrl || null;
  // A wide-only upload still white-labels: the expanded rail wears the wordmark
  // and the collapsed rail keeps the stock mark rather than showing nothing.
  if (!logoUrl && !logoDarkUrl && !logoWideUrl && !logoWideDarkUrl) {
    return null;
  }

  return {
    logoUrl,
    logoDarkUrl,
    logoWideUrl,
    logoWideDarkUrl,
    displayName: branding.clientName || null,
  };
}
