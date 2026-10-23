// Client-component-safe: no server imports. Settings UI and server code both read these.
export const DATTO_RMM_PROVIDER = 'datto' as const;

export const DATTO_RMM_PLATFORMS = ['pinotage', 'merlot', 'concord', 'vidal', 'zinfandel', 'syrah'] as const;
export type DattoRmmPlatform = typeof DATTO_RMM_PLATFORMS[number];

// Tenant-secret names. Here rather than in the actions module so non-action
// callers (device sync, alert polling) can build a client without importing a
// server-actions file.
export const DATTO_RMM_SECRET_KEYS = {
  apiKey: 'datto_rmm_api_key',
  apiSecret: 'datto_rmm_api_secret',
  accessToken: 'datto_rmm_access_token',
  accessTokenExpiresAt: 'datto_rmm_access_token_expires_at',
  webhookSecret: 'datto_rmm_webhook_secret',
} as const;

export const DATTO_RMM_WEBHOOK_HEADER = 'x-alga-webhook-secret';

export function dattoPlatformApiUrl(platform: DattoRmmPlatform): string {
  return `https://${platform}-api.centrastage.net/api`;
}

// `deviceSync` / `alertPolling` keys are owned by the shared settings code and
// are left untouched here.
export interface DattoRmmIntegrationSettingsJson {
  platform?: DattoRmmPlatform | 'custom';
  rebootComponentUid?: string | null;
  resolveAlertsOnTicketClose?: boolean;
  softwareIngestOnSync?: boolean;
  /**
   * When a scheduled site sync finds a site for the first time, create (or link
   * by name) an Alga client for it. Off by default: sites are only suggested.
   */
  autoCreateClientsForNewSites?: boolean;
  [key: string]: unknown;
}
