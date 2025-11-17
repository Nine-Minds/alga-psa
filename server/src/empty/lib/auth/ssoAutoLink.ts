/**
 * Community Edition placeholder for SSO Auto Link functionality.
 * EE features are not available in CE.
 */

export async function isAutoLinkEnabledForTenant(
  tenantId: string | undefined,
  userType: "internal" | "client"
): Promise<boolean> {
  // SSO Auto Link is an EE feature, always return false in CE
  return false;
}