import {
  DEFAULT_MICROSOFT_GRAPH_BASE_URL,
  DEFAULT_MICROSOFT_LOGIN_BASE_URL,
  getMicrosoftGraphBaseUrl as getConfiguredGraphBaseUrl,
  getMicrosoftLoginBaseUrl as getConfiguredLoginBaseUrl,
} from '@shared/services/email/microsoftGraphEndpoints';
import { isTeamsEmulatorModeEnabled } from './emulatorMode';

/**
 * Microsoft endpoints for the Teams surface, so `algasim` can stand in for
 * Microsoft. These are the endpoints the bot secret, the setup-probe
 * credentials, the Graph client secret, and activity-notification bearer
 * tokens are sent to, so the overrides are honored only when the emulator
 * gate is explicitly on — matching the posture of TEAMS_BOT_OPENID_CONFIG_URL
 * and TEAMS_BOT_SERVICE_URL_ALLOWLIST.
 *
 * The email module keeps honoring MICROSOFT_*_BASE_URL unconditionally; that is
 * pre-existing behavior and deliberately unchanged here.
 */
export function getMicrosoftGraphBaseUrl(): string {
  return isTeamsEmulatorModeEnabled()
    ? getConfiguredGraphBaseUrl()
    : DEFAULT_MICROSOFT_GRAPH_BASE_URL;
}

export function getMicrosoftLoginBaseUrl(): string {
  return isTeamsEmulatorModeEnabled()
    ? getConfiguredLoginBaseUrl()
    : DEFAULT_MICROSOFT_LOGIN_BASE_URL;
}

export function getMicrosoftTokenUrl(tenantAuthority: string): string {
  return `${getMicrosoftLoginBaseUrl()}/${encodeURIComponent(tenantAuthority)}/oauth2/v2.0/token`;
}
