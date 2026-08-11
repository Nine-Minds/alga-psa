import {
  DEFAULT_MICROSOFT_GRAPH_BASE_URL,
  DEFAULT_MICROSOFT_LOGIN_BASE_URL,
  getMicrosoftGraphBaseUrl as getConfiguredGraphBaseUrl,
  getMicrosoftLoginBaseUrl as getConfiguredLoginBaseUrl,
} from '@shared/services/email/microsoftGraphEndpoints';

/**
 * Microsoft endpoints for the Teams surface, so `algasim` can stand in for
 * Microsoft outside production. These are the endpoints the bot secret, the
 * setup-probe credentials, the Graph client secret, and activity-notification
 * bearer tokens are sent to, so under NODE_ENV=production the overrides are
 * ignored and the real Microsoft hosts are always used — matching the posture
 * of TEAMS_BOT_OPENID_CONFIG_URL and TEAMS_BOT_SERVICE_URL_ALLOWLIST.
 *
 * The email module keeps honoring MICROSOFT_*_BASE_URL unconditionally; that is
 * pre-existing behavior and deliberately unchanged here.
 */
export function getMicrosoftGraphBaseUrl(): string {
  return process.env.NODE_ENV === 'production'
    ? DEFAULT_MICROSOFT_GRAPH_BASE_URL
    : getConfiguredGraphBaseUrl();
}

export function getMicrosoftLoginBaseUrl(): string {
  return process.env.NODE_ENV === 'production'
    ? DEFAULT_MICROSOFT_LOGIN_BASE_URL
    : getConfiguredLoginBaseUrl();
}

export function getMicrosoftTokenUrl(tenantAuthority: string): string {
  return `${getMicrosoftLoginBaseUrl()}/${encodeURIComponent(tenantAuthority)}/oauth2/v2.0/token`;
}
