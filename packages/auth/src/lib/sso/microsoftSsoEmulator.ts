/**
 * Single deny-by-default gate for pointing Microsoft sign-in at the algasim
 * Microsoft simulator (`packages/emulators/msgraph`) instead of Entra, so the
 * OAuth sign-in and profile-link flows — including the failures this product
 * has to explain on screen — can be driven without a Microsoft tenant.
 *
 * It decides where the browser is sent to authenticate and whose profile may
 * become an AlgaPSA session, so it must never turn itself on: a host with
 * NODE_ENV unset, or set to "staging", is not a licence to redirect it.
 * Production is a hard second lock the flag cannot unlock.
 */
const ENABLED_VALUES = new Set(['true', '1']);

export function isMicrosoftSsoEmulatorEnabled(): boolean {
    if (process.env.NODE_ENV === 'production') {
        return false;
    }
    const raw = process.env.MICROSOFT_SSO_EMULATOR_MODE?.trim().toLowerCase();
    return raw !== undefined && ENABLED_VALUES.has(raw);
}

/** Default algasim msgraph port; the suite serves login and Graph on one origin. */
const DEFAULT_SIMULATOR_BASE_URL = 'http://localhost:4010';

function withoutTrailingSlash(value: string): string {
    return value.replace(/\/+$/, '');
}

function simulatorLoginBaseUrl(): string {
    return withoutTrailingSlash(
        (process.env.MICROSOFT_LOGIN_BASE_URL || '').trim() || DEFAULT_SIMULATOR_BASE_URL
    );
}

function simulatorGraphBaseUrl(): string {
    return withoutTrailingSlash(
        (process.env.MICROSOFT_GRAPH_BASE_URL || '').trim() || `${simulatorLoginBaseUrl()}/v1.0`
    );
}

export interface MicrosoftSsoEmulatorEndpoints {
    authorization: string;
    token: string;
    userinfo: string;
}

/**
 * The simulator mints opaque tokens and no signed id_token, so the sign-in
 * provider runs as plain OAuth2 against these endpoints and reads the account
 * from Graph `/me` rather than from OIDC discovery.
 */
export function getMicrosoftSsoEmulatorEndpoints(authority = 'common'): MicrosoftSsoEmulatorEndpoints {
    const login = simulatorLoginBaseUrl();
    return {
        authorization: `${login}/${encodeURIComponent(authority)}/oauth2/v2.0/authorize`,
        token: `${login}/${encodeURIComponent(authority)}/oauth2/v2.0/token`,
        userinfo: `${simulatorGraphBaseUrl()}/me`,
    };
}
