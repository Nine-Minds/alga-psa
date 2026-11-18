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
  /**
   * 'api_client' | 'legacy_api_token'. Absent on rows saved before CIPP API
   * clients existed, which is why a missing value means legacy: no migration.
   */
  authType: 'entra_cipp_auth_type',
  /** CIPP > Integrations > CIPP-API: Application (client) ID. */
  clientId: 'entra_cipp_client_id',
  clientSecret: 'entra_cipp_client_secret',
  /** CIPP > Integrations > CIPP-API: Tenant (directory) ID that hosts the client. */
  directoryId: 'entra_cipp_directory_id',
} as const;

export const ENTRA_ALL_SECRET_KEYS = [
  ...Object.values(ENTRA_DIRECT_SECRET_KEYS),
  ...Object.values(ENTRA_CIPP_SECRET_KEYS),
] as const;

export type EntraSecretKey = (typeof ENTRA_ALL_SECRET_KEYS)[number];
