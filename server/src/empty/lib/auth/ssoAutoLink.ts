export async function isAutoLinkEnabledForTenant(
  _tenantId: string | undefined,
  _userType: "internal" | "client"
): Promise<boolean> {
  // CE build stub: SSO auto-linking is enterprise-only
  return false;
}
