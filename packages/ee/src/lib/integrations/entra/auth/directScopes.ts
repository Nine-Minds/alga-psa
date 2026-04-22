// Delegated scopes requested for the Direct Microsoft Partner OAuth flow.
// ManagedTenants.Read.All is required so the access token can hit
// /tenantRelationships/managedTenants/{tenants,users} during GDAP-backed discovery.
// Directory.Read.All is only used by the smoke-only self-tenant mode (ENTRA_DIRECT_SMOKE_SELF_TENANT_MODE)
// to call /organization and /users against the partner's own tenant when no GDAP relationships exist.
// Admin consent must be granted on the Azure app registration for ManagedTenants.Read.All and Directory.Read.All.
export const ENTRA_DIRECT_DELEGATED_SCOPES = [
  'https://graph.microsoft.com/User.Read',
  'https://graph.microsoft.com/ManagedTenants.Read.All',
  'https://graph.microsoft.com/Directory.Read.All',
  'offline_access',
] as const;

export const ENTRA_DIRECT_SCOPE_STRING = ENTRA_DIRECT_DELEGATED_SCOPES.join(' ');
