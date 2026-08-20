export interface MspBranding {
  /** Tenant logo for light surfaces; null keeps the stock Alga mark. */
  logoUrl: string | null;
  /** Optional logo for dark surfaces; falls back to logoUrl. */
  logoDarkUrl: string | null;
  /** Tenant display name shown next to the logo. */
  displayName: string | null;
}

export const EMPTY_MSP_BRANDING: MspBranding = {
  logoUrl: null,
  logoDarkUrl: null,
  displayName: null,
};

interface TenantLogoSource {
  logoUrl?: string;
  logoDarkUrl?: string;
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
  if (!logoUrl && !logoDarkUrl) {
    return null;
  }

  return {
    logoUrl,
    logoDarkUrl,
    displayName: branding.clientName || null,
  };
}
