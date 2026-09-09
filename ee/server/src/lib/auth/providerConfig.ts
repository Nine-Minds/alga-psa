import logger from "@alga-psa/core/logger";

export interface SsoProviderOption {
  id: "google" | "azure-ad";
  name: string;
  description: string;
  configured: boolean;
}

type SsoProviderId = SsoProviderOption["id"];

type SsoResolution = typeof import("@alga-psa/auth/lib/sso/mspSsoResolution");

async function loadSsoResolution(): Promise<SsoResolution | null> {
  try {
    return await import("@alga-psa/auth/lib/sso/mspSsoResolution");
  } catch (error) {
    logger.warn("[provider-config] Failed to load SSO credential resolution", { error });
    return null;
  }
}

// Mirrors the sign-in resolver so the settings surfaces report exactly what
// `resolveMspSsoCredentialSource` would accept: the tenant provider profile
// first, app-level secrets/env as the fallback.
async function isProviderConfigured(
  resolution: SsoResolution | null,
  provider: SsoProviderId,
  tenantId?: string
): Promise<boolean> {
  if (!resolution) return false;

  if (tenantId) {
    try {
      if (await resolution.hasTenantProviderCredentials(tenantId, provider)) {
        return true;
      }
    } catch (error) {
      logger.warn("[provider-config] Failed to check tenant provider credentials", {
        provider,
        error,
      });
    }
  }

  try {
    return await resolution.hasAppFallbackProviderCredentials(provider);
  } catch (error) {
    logger.warn("[provider-config] Failed to check app provider credentials", { provider, error });
    return false;
  }
}

export async function getSsoProviderOptions(tenantId?: string): Promise<SsoProviderOption[]> {
  const resolution = await loadSsoResolution();
  const [googleConfigured, microsoftConfigured] = await Promise.all([
    isProviderConfigured(resolution, "google", tenantId),
    isProviderConfigured(resolution, "azure-ad", tenantId),
  ]);

  return [
    {
      id: "google",
      name: "Google Workspace",
      description: "Let users sign in with their Google-managed identity.",
      configured: googleConfigured,
    },
    {
      id: "azure-ad",
      name: "Microsoft 365 (Azure AD)",
      description: "Allow Azure Active Directory accounts to access AlgaPSA.",
      configured: microsoftConfigured,
    },
  ];
}
