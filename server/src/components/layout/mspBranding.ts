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
 * Resolves the mark the MSP shell wears. An uploaded tenant logo replaces the
 * Alga avatar on Enterprise as soon as it exists — the same logo the client
 * portal already uses — so there is no second switch to find. Community
 * installs and tenants without a logo keep the stock chrome.
 */
export function resolveMspBranding(
  branding: TenantLogoSource | null | undefined,
  options: { isEnterprise: boolean },
): MspBranding | null {
  if (!options.isEnterprise || !branding) {
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
