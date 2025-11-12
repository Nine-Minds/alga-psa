import logger from "@alga-psa/shared/core/logger";

export interface SsoProviderOption {
  id: "google" | "azure-ad";
  name: string;
  description: string;
  configured: boolean;
}

async function loadSecret(name: string): Promise<string | undefined> {
  try {
    const { getSecretProviderInstance } = await import("@alga-psa/shared/core/secretProvider");
    const secretProvider = await getSecretProviderInstance();
    return await secretProvider.getAppSecret(name);
  } catch (error) {
    logger.warn("[provider-config] Failed to load secret", { name, error });
    return undefined;
  }
}

export async function getSsoProviderOptions(): Promise<SsoProviderOption[]> {
  const [
    googleClientIdFromSecret,
    googleClientSecretFromSecret,
    microsoftClientIdFromSecret,
    microsoftClientSecretFromSecret,
  ] = await Promise.all([
    loadSecret("GOOGLE_OAUTH_CLIENT_ID"),
    loadSecret("GOOGLE_OAUTH_CLIENT_SECRET"),
    loadSecret("MICROSOFT_OAUTH_CLIENT_ID"),
    loadSecret("MICROSOFT_OAUTH_CLIENT_SECRET"),
  ]);

  const googleClientId = googleClientIdFromSecret || process.env.GOOGLE_OAUTH_CLIENT_ID;
  const googleClientSecret = googleClientSecretFromSecret || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const microsoftClientId = microsoftClientIdFromSecret || process.env.MICROSOFT_OAUTH_CLIENT_ID;
  const microsoftClientSecret =
    microsoftClientSecretFromSecret || process.env.MICROSOFT_OAUTH_CLIENT_SECRET;

  return [
    {
      id: "google",
      name: "Google Workspace",
      description: "Let users sign in with their Google-managed identity.",
      configured: Boolean(googleClientId && googleClientSecret),
    },
    {
      id: "azure-ad",
      name: "Microsoft 365 (Azure AD)",
      description: "Allow Azure Active Directory accounts to access Alga PSA.",
      configured: Boolean(microsoftClientId && microsoftClientSecret),
    },
  ];
}
