/**
 * SSO Auto-Link - CE stub
 *
 * This is a placeholder for Community Edition.
 * Enterprise Edition provides real implementation in ee/server.
 */

// No longer used - auth uses the registry pattern instead.
// Kept for any external code that might still import from here.

export async function isAutoLinkEnabledForTenant(
  _tenantId: string | undefined,
  _userType: "internal" | "client"
): Promise<boolean> {
  return false;
}
