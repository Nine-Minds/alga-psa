// Delegated scopes requested for the Direct Microsoft Partner OAuth flow.
// ManagedTenants.Read.All is required so the access token can hit
// /tenantRelationships/managedTenants/tenants during GDAP-backed discovery.
// Directory.Read.All covers the per-customer-tenant directory reads (/users,
// /groups, checkMemberGroups) made with tokens minted against each managed
// tenant's authority, and is also what the smoke-only self-tenant mode
// (ENTRA_DIRECT_SMOKE_SELF_TENANT_MODE) uses against the partner's own tenant.
// Admin consent must be granted on the Azure app registration for ManagedTenants.Read.All and Directory.Read.All.
export const ENTRA_DIRECT_DELEGATED_SCOPES = [
  'https://graph.microsoft.com/User.Read',
  'https://graph.microsoft.com/ManagedTenants.Read.All',
  'https://graph.microsoft.com/Directory.Read.All',
  'offline_access',
] as const;

export const ENTRA_DIRECT_SCOPE_STRING = ENTRA_DIRECT_DELEGATED_SCOPES.join(' ');
