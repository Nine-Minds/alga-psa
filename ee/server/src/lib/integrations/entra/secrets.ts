export const ENTRA_SHARED_MICROSOFT_SECRET_KEYS = {
  clientId: 'microsoft_client_id',
  clientSecret: 'microsoft_client_secret',
  tenantId: 'microsoft_tenant_id',
} as const;

export const ENTRA_DIRECT_SECRET_KEYS = {
  accessToken: 'entra_direct_access_token',
  refreshToken: 'entra_direct_refresh_token',
  tokenExpiresAt: 'entra_direct_token_expires_at',
  partnerTenantId: 'entra_direct_partner_tenant_id',
  tokenScope: 'entra_direct_token_scope',
} as const;

export const ENTRA_CIPP_SECRET_KEYS = {
  baseUrl: 'entra_cipp_base_url',
  apiToken: 'entra_cipp_api_token',
} as const;

export const ENTRA_ALL_SECRET_KEYS = [
  ...Object.values(ENTRA_SHARED_MICROSOFT_SECRET_KEYS),
  ...Object.values(ENTRA_DIRECT_SECRET_KEYS),
  ...Object.values(ENTRA_CIPP_SECRET_KEYS),
] as const;

export type EntraSecretKey = (typeof ENTRA_ALL_SECRET_KEYS)[number];
