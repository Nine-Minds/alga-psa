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

export function getMicrosoftSsoEmulatorIssuer(authority = 'common'): string {
    return `${simulatorLoginBaseUrl()}/${encodeURIComponent(authority)}/v2.0`;
}

/** Used only after isMicrosoftSsoEmulatorEnabled passes its production lock. */
export function buildMicrosoftSsoEmulatorProvider(config: {
    clientId: string;
    clientSecret: string;
    authority: string;
    profile: (profile: Record<string, any>) => Promise<any>;
}) {
    const issuer = getMicrosoftSsoEmulatorIssuer(config.authority);
    let keys: ReturnType<typeof import('jose').createRemoteJWKSet> | undefined;
    return {
        id: 'azure-ad', name: 'Microsoft', type: 'oidc' as const,
        issuer,
        clientId: config.clientId, clientSecret: config.clientSecret,
        checks: ['pkce', 'state', 'nonce'] as Array<'pkce' | 'state' | 'nonce'>,
        authorization: { params: { scope: 'openid email profile https://graph.microsoft.com/User.Read' } },
        token: {
            async conform(response: Response): Promise<Response> {
                if (response.ok) {
                    const tokens = await response.clone().json();
                    const { createRemoteJWKSet, jwtVerify } = await import('jose');
                    keys ??= createRemoteJWKSet(new URL(issuer.replace(/\/v2\.0$/, '/discovery/v2.0/keys')));
                    await jwtVerify(tokens.id_token, keys, { issuer, audience: config.clientId, algorithms: ['RS256'] });
                }
                return response;
            },
        },
        profile: config.profile,
    };
}

/** Explicit endpoints remain available to non-OIDC integration adapters. */
export function getMicrosoftSsoEmulatorEndpoints(authority = 'common'): MicrosoftSsoEmulatorEndpoints {
    const login = simulatorLoginBaseUrl();
    return {
        authorization: `${login}/${encodeURIComponent(authority)}/oauth2/v2.0/authorize`,
        token: `${login}/${encodeURIComponent(authority)}/oauth2/v2.0/token`,
        userinfo: `${simulatorGraphBaseUrl()}/me`,
    };
}
