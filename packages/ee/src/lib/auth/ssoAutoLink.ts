// Community Edition stub for SSO Auto-link functionality
// This feature is only available in Enterprise Edition

export async function isAutoLinkEnabledForTenant(
  tenantId: string | undefined,
  userType: "internal" | "client"
): Promise<boolean> {
  return false;
}
