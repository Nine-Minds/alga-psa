import CredentialsProvider from "next-auth/providers/credentials";
import KeycloakProvider from "next-auth/providers/keycloak";
import GoogleProvider from "next-auth/providers/google";
import AzureADProvider from "next-auth/providers/azure-ad";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextAuthConfig } from "next-auth";
import "server/src/types/next-auth";
import { AnalyticsEvents } from "server/src/lib/analytics/events";
// import { getAdminConnection } from "server/src/lib/db/admin";
import {
    getNextAuthSecret,
    getNextAuthSecretSync,
    getSessionCookieConfig,
    getSessionMaxAge,
    type PortalSessionTokenPayload,
} from "server/src/lib/auth/sessionCookies";
import { issuePortalDomainOtt } from "server/src/lib/models/PortalDomainSessionToken";
import { buildTenantPortalSlug, isValidTenantSlug } from "@shared/utils/tenantSlug";
import { isEnterprise } from "server/src/lib/features";
import {
    applyOAuthAccountHints,
    decodeOAuthJwtPayload,
    mapOAuthProfileToExtendedUser,
} from "@ee/lib/auth/ssoProviders";
import type { OAuthProfileMappingResult } from "@ee/lib/auth/ssoProviders";
import {
    OAuthAccountLinkConflictError,
    upsertOAuthAccountLink,
    findOAuthAccountLink,
} from "@ee/lib/auth/oauthAccountLinks";
import { isAutoLinkEnabledForTenant } from "@ee/lib/auth/ssoAutoLink";
import type { OAuthLinkProvider } from "@ee/lib/auth/oauthAccountLinks";
import { cookies } from "next/headers";
import { UserSession } from "server/src/lib/models/UserSession";
import { getClientIp } from "server/src/lib/auth/ipAddress";
import { generateDeviceFingerprint, getDeviceInfo } from "server/src/lib/auth/deviceFingerprint";
import { getLocationFromIp } from "server/src/lib/auth/geolocation";
import { getConnection } from "server/src/lib/db/db";

function applyPortToVanityUrl(url: URL, portCandidate: string | undefined, protocol: string): void {
    if (!portCandidate || portCandidate.length === 0) {
        return;
    }

    const isHttpsDefault = protocol === 'https:' && portCandidate === '443';
    const isHttpDefault = protocol === 'http:' && portCandidate === '80';

    if (isHttpsDefault || isHttpDefault) {
        return;
    }

    url.port = portCandidate;
}

const SESSION_MAX_AGE = getSessionMaxAge();
const SESSION_COOKIE = getSessionCookieConfig();

async function computeVanityRedirect({
    url,
    baseUrl,
    token,
}: {
    url: string;
    baseUrl: string;
    token?: Record<string, unknown> | null;
}): Promise<string | null> {
    if (!token) {
        console.log('[computeVanityRedirect] missing token', { url, baseUrl });
        return null;
    }

    const userType = token.user_type;
    const tenantId = token.tenant;

    if (userType !== 'client' || typeof tenantId !== 'string' || tenantId.length === 0) {
        console.log('[computeVanityRedirect] token not eligible', { userType, tenantId });
        return null;
    }

    const base = new URL(baseUrl);
    const target = new URL(url, baseUrl);

    const userIdCandidate = token.id ?? token.sub;
    if (typeof userIdCandidate !== 'string' || userIdCandidate.length === 0) {
        console.log('[computeVanityRedirect] missing user id', { tokenKeys: Object.keys(token) });
        return null;
    }

    try {
        console.log('[computeVanityRedirect] begin lookup', {
            tenantId,
            userIdCandidate,
            base: baseUrl,
            target: target.toString(),
        });
        const { getAdminConnection } = await import('@shared/db/admin');
        const {
            getPortalDomain,
            getPortalDomainByHostname,
        } = await import('server/src/models/PortalDomainModel');
        const knex = await getAdminConnection();

        const isSameOrigin = target.origin === base.origin;

        const fetchPortalDomainForTenant = async () => {
            const portalDomain = await getPortalDomain(knex, tenantId);
            if (!portalDomain || portalDomain.status !== 'active') {
                return null;
            }
            return portalDomain;
        };

        const fetchPortalDomainForHost = async (hostname: string, port?: string) => {
            const candidates = [hostname];
            if (port && port.length > 0 && port !== '80' && port !== '443') {
                candidates.unshift(`${hostname}:${port}`);
            }

            for (const candidate of candidates) {
                const portalDomain = await getPortalDomainByHostname(knex, candidate);
                if (!portalDomain || portalDomain.status !== 'active') {
                    continue;
                }
                if (portalDomain.tenant !== tenantId) {
                    continue;
                }
                return portalDomain;
            }

            return null;
        };

        const returnPath = `${target.pathname}${target.search ?? ''}`;
        const protocol = isSameOrigin ? base.protocol : target.protocol;
        const portalDomain = isSameOrigin
            ? await fetchPortalDomainForTenant()
            : await fetchPortalDomainForHost(target.hostname, target.port);

        if (!portalDomain) {
            console.log('[computeVanityRedirect] portal domain not found', {
                tenant: tenantId,
                targetHost: target.hostname,
                isSameOrigin,
            });
            return null;
        }

        if (!isSameOrigin && target.pathname.startsWith('/auth/client-portal/handoff')) {
            console.log('[computeVanityRedirect] target already handoff', { target: target.toString() });
            return null;
        }

        if (isSameOrigin) {
            console.log('[computeVanityRedirect] same origin target', { target: target.toString() });
            if (!target.pathname.startsWith('/client-portal')) {
                console.log('[computeVanityRedirect] same origin but not client portal', { pathname: target.pathname });
                return null;
            }

            if (target.pathname.startsWith('/auth/client-portal/handoff')) {
                console.log('[computeVanityRedirect] same origin and already handoff', { target: target.toString() });
                return null;
            }
        }

        const userSnapshot: PortalSessionTokenPayload = {
            id: userIdCandidate,
            email: typeof token.email === 'string' ? token.email : undefined,
            name: typeof token.name === 'string' ? token.name : undefined,
            tenant: tenantId,
            user_type: userType,
            clientId: typeof token.clientId === 'string' ? token.clientId : undefined,
            contactId: typeof token.contactId === 'string' ? token.contactId : undefined,
            session_id: typeof token.session_id === 'string' ? token.session_id : undefined, // NEW: Preserve session ID
            login_method: typeof token.login_method === 'string' ? token.login_method : undefined, // NEW: Preserve login method
        };

        const { token: ott } = await issuePortalDomainOtt({
            tenant: portalDomain.tenant,
            portalDomainId: portalDomain.id,
            userId: userIdCandidate,
            targetDomain: portalDomain.domain,
            userSnapshot,
            issuedFromHost: base.host,
            returnPath,
        });

        const vanityUrl = new URL(`${protocol}//${portalDomain.domain}/auth/client-portal/handoff`);
        const desiredPort = isSameOrigin ? base.port : target.port;
        applyPortToVanityUrl(vanityUrl, desiredPort, protocol);
        vanityUrl.searchParams.set('ott', ott);
        vanityUrl.searchParams.set('return', returnPath);

        console.log('[computeVanityRedirect] redirecting to vanity host', {
            base: base.origin,
            target: target.toString(),
            vanity: vanityUrl.toString(),
            tenant: tenantId,
            user: userIdCandidate,
        });

        return vanityUrl.toString();
    } catch (error) {
        console.warn('Failed to prepare vanity redirect for client portal', error);
        return null;
    }
}

// Extend the User type to include tenant
interface ExtendedUser {
    id: string;
    email: string;
    name: string;
    username: string;
    image?: string;
    proToken: string;
    tenant?: string;
    tenantSlug?: string;
    user_type: string;
    clientId?: string;
    contactId?: string;
    deviceInfo?: {
        ip: string;
        userAgent: string;
        deviceFingerprint: string;
        deviceName: string;
        deviceType: string;
        locationData: any;
    };
    loginMethod?: string;
}

function toOAuthProfileMappingResult(user: ExtendedUser): OAuthProfileMappingResult {
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        username: user.username,
        image: user.image,
        proToken: user.proToken,
        tenant: user.tenant,
        tenantSlug: user.tenantSlug,
        user_type: user.user_type === 'client' ? 'client' : 'internal',
        clientId: user.clientId,
        contactId: user.contactId,
    };
}

const OAUTH_PROVIDER_ALIASES: Record<string, OAuthLinkProvider> = {
    google: 'google',
    'azure-ad': 'microsoft',
    microsoft: 'microsoft',
};

function normalizeOAuthProvider(providerId?: string | null): OAuthLinkProvider | null {
    if (!providerId) {
        return null;
    }
    return OAUTH_PROVIDER_ALIASES[providerId] ?? null;
}

function toOptionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function pickFirstString(values: unknown[]): string | undefined {
    for (const value of values) {
        const candidate = toOptionalString(value);
        if (candidate) {
            return candidate;
        }
    }
    return undefined;
}

function getSafeRecord(value: unknown): Record<string, unknown> | undefined {
    if (value && typeof value === 'object') {
        return value as Record<string, unknown>;
    }
    return undefined;
}

function decodeBase64Url(value: string): string | null {
    if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) {
        return null;
    }

    try {
        const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
        const padding = (4 - (normalized.length % 4 || 4)) % 4;
        const padded = normalized + '='.repeat(padding);
        return Buffer.from(padded, 'base64').toString('utf8');
    } catch {
        return null;
    }
}

function parseStateValue(rawState: unknown, key: string): string | undefined {
    const asString = toOptionalString(rawState);
    if (!asString) {
        return undefined;
    }

    const candidates = [asString];
    const decoded = decodeBase64Url(asString);
    if (decoded) {
        // OAuth providers can transform or strip the state query; hang on to a decoded copy as a fallback.
        candidates.unshift(decoded);
    }

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            const value = (parsed as Record<string, unknown>)[key];
            if (typeof value === 'number' && Number.isFinite(value)) {
                return String(value);
            }
            const stringValue = toOptionalString(value);
            if (stringValue !== undefined) {
                return stringValue;
            }
        } catch {
            // ignore
        }

        try {
            const params = new URLSearchParams(candidate);
            const value = params.get(key);
            if (value !== null) {
                return value;
            }
        } catch {
            // ignore
        }
    }

    return undefined;
}

const LINK_SIGNATURE_TTL_MS = 5 * 60 * 1000;
const LINK_STATE_COOKIE = 'sso-link-state';

// Recompute the client-issued signature so we can validate the callback payload without reaching for shared code.
function computeLinkSignature(secret: string, userId: string, nonce: string, issuedAt: number): string {
    return createHmac('sha256', secret)
        .update(`${userId}:${nonce}:${issuedAt}`)
        .digest('hex');
}

function validateLinkSignature(
    userId: string,
    linkNonce: string | undefined,
    linkIssuedAt: string | number | undefined,
    linkSignature: string | undefined,
): boolean {
    if (!linkNonce || !linkSignature || linkIssuedAt === undefined || linkIssuedAt === null) {
        console.warn('[oauth] link signature missing fields', {
            hasNonce: Boolean(linkNonce),
            hasSignature: Boolean(linkSignature),
            linkIssuedAt,
        });
        return false;
    }

    const issuedAt = typeof linkIssuedAt === 'number' ? linkIssuedAt : Number(linkIssuedAt);
    if (!Number.isFinite(issuedAt)) {
        console.warn('[oauth] link signature issuedAt invalid', { linkIssuedAt });
        return false;
    }

    if (Date.now() - issuedAt > LINK_SIGNATURE_TTL_MS) {
        console.warn('[oauth] link signature expired', { userId, issuedAt });
        return false;
    }

    const secret = getNextAuthSecretSync();
    if (!secret) {
        console.warn('[oauth] missing NEXTAUTH_SECRET when validating link signature');
        return false;
    }

    const expected = computeLinkSignature(secret, userId, linkNonce, issuedAt);

    try {
        const expectedBuf = Buffer.from(expected, 'hex');
        const providedBuf = Buffer.from(linkSignature, 'hex');
        const matches =
            expectedBuf.length === providedBuf.length &&
            timingSafeEqual(expectedBuf, providedBuf);

        if (!matches) {
            console.warn('[oauth] link signature mismatch', {
                userId,
                linkNonce,
                issuedAt,
            });
        } else {
            console.log('[oauth] link signature validated', { userId, nonce: linkNonce });
        }

        return matches;
    } catch (error) {
        console.warn('[oauth] link signature comparison failed', { error });
        return false;
    }
}

interface OAuthAccountMetadata {
    scope?: string;
    linkMode?: string;
    linkNonce?: string;
    linkNonceIssuedAt?: string | number;
    linkNonceSignature?: string;
    tenantHint?: string;
    vanityHostHint?: string;
    sessionState?: string;
    idTokenClaims?: Record<string, unknown>;
}

function extractOAuthAccountMetadata(
    account: Record<string, unknown> | null | undefined,
): OAuthAccountMetadata {
    if (!account) {
        return {};
    }

    console.log('[oauth] account payload received', {
        keys: Object.keys(account),
        hasParams: typeof account.params === 'object',
        rawParams: account.params,
    });

    const metadata: OAuthAccountMetadata = {};
    const params = getSafeRecord(account.params);
    const rawState = account.state ?? params?.state;
    console.log('[oauth] raw state candidates', {
        accountState: account.state,
        paramsState: params?.state,
        hasParams: Boolean(params),
    });

    const scope = toOptionalString(account.scope);
    if (scope) {
        metadata.scope = scope;
    }

    const linkMode = parseStateValue(rawState, 'mode');
    if (linkMode) {
        metadata.linkMode = linkMode;
    }

    const linkNonce = parseStateValue(rawState, 'nonce');
    if (linkNonce) {
        metadata.linkNonce = linkNonce;
    }

    const linkNonceIssuedAt = parseStateValue(rawState, 'nonceIssuedAt');
    if (linkNonceIssuedAt) {
        metadata.linkNonceIssuedAt = linkNonceIssuedAt;
    }

    const linkNonceSignature = parseStateValue(rawState, 'nonceSignature');
    if (linkNonceSignature) {
        metadata.linkNonceSignature = linkNonceSignature;
    }

    const tenantHint = pickFirstString([
        account.tenant,
        account.tenant_hint,
        account.tenantId,
        account.tenant_id,
        params?.tenant,
        params?.tenant_hint,
    ]);
    if (tenantHint) {
        metadata.tenantHint = tenantHint;
    }

    const vanityHostHint = pickFirstString([
        account.vanity_host,
        params?.vanity_host,
    ]);
    if (vanityHostHint) {
        metadata.vanityHostHint = vanityHostHint;
    }

    const sessionState = toOptionalString(account.session_state);
    if (sessionState) {
        metadata.sessionState = sessionState;
    }

    const idToken = toOptionalString(account.id_token);
    const claims = decodeOAuthJwtPayload(idToken);
    if (claims) {
        const allowedClaims = ['sub', 'tid', 'oid', 'email', 'upn', 'preferred_username'];
        const filteredClaims: Record<string, unknown> = {};
        for (const key of allowedClaims) {
            const claimValue = claims[key];
            if (typeof claimValue === 'string' && claimValue.length > 0) {
                filteredClaims[key] = claimValue;
            }
        }
        if (Object.keys(filteredClaims).length > 0) {
            metadata.idTokenClaims = filteredClaims;
        }
    }

    return metadata;
}

interface LinkStateCookiePayload {
    userId: string;
    nonce: string;
    issuedAt: number;
    signature: string;
}

// Pull the signed link state out of the HTTP-only cookie in case the provider drops the `state` parameter.
async function consumeLinkStateCookie(
    expectedUserId: string | undefined,
): Promise<LinkStateCookiePayload | undefined> {
    try {
        const store = await cookies();
        const stored = store.get(LINK_STATE_COOKIE);
        if (!stored) {
            return undefined;
        }

        store.delete(LINK_STATE_COOKIE);

        try {
            const normalized = stored.value.replace(/-/g, '+').replace(/_/g, '/');
            const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
            const decoded = Buffer.from(padded, 'base64').toString('utf8');
            const payload = JSON.parse(decoded) as Partial<LinkStateCookiePayload>;
            if (
                !payload ||
                typeof payload.userId !== 'string' ||
                typeof payload.nonce !== 'string' ||
                typeof payload.signature !== 'string' ||
                typeof payload.issuedAt !== 'number'
            ) {
                console.warn('[oauth] link state cookie malformed', { payload });
                return undefined;
            }

            if (expectedUserId && payload.userId !== expectedUserId) {
                console.warn('[oauth] link state cookie user mismatch - rejecting stale cookie', {
                    expected: expectedUserId,
                    actual: payload.userId,
                });
                // SECURITY FIX: Reject stale cookies to prevent phantom user_id issues
                // A mismatch indicates a stale cookie from a previous SSO attempt that should not be used
                return undefined;
            }

            return payload as LinkStateCookiePayload;
        } catch (error) {
            console.warn('[oauth] failed to parse link state cookie', { error });
            return undefined;
        }
    } catch (error) {
        console.warn('[oauth] unable to access cookies when consuming link state', { error });
        return undefined;
    }
}

function extractProviderAccountId(
    account: Record<string, unknown> | null | undefined,
    metadata: OAuthAccountMetadata,
): string | undefined {
    const direct = toOptionalString(account?.providerAccountId);
    if (direct) {
        return direct;
    }

    const legacyId = toOptionalString(account?.id);
    if (legacyId) {
        return legacyId;
    }

    const claims = metadata.idTokenClaims as Record<string, unknown> | undefined;
    if (claims && typeof claims.sub === 'string' && claims.sub.length > 0) {
        return claims.sub;
    }

    return undefined;
}

async function ensureOAuthAccountLink(
    user: ExtendedUser | undefined,
    account: Record<string, unknown> | null | undefined,
    providerId?: string | null,
): Promise<void> {
    if (!user || !providerId) {
        return;
    }

    const normalizedProvider = normalizeOAuthProvider(providerId);
    if (!normalizedProvider || !user.tenant) {
        return;
    }

    const metadata = extractOAuthAccountMetadata(account);
    const providerAccountId = extractProviderAccountId(account, metadata);
    if (!providerAccountId) {
        console.warn('[oauth] Missing provider account identifier', {
            providerId,
            userId: user.id,
            accountKeys: account ? Object.keys(account) : null,
            accountSnapshot: account,
        });
        return;
    }

    // Some providers echo only an access token back; fall back to the cookie if the signed link fields are missing.
    // SECURITY FIX: Pass user.id to reject stale cookies from different users/tenants
    const cookieState =
        !metadata.linkNonce || !metadata.linkNonceSignature
            ? await consumeLinkStateCookie(user.id)
            : undefined;

    if (cookieState) {
        metadata.linkMode = metadata.linkMode ?? 'link';
        metadata.linkNonce = metadata.linkNonce ?? cookieState.nonce;
        metadata.linkNonceIssuedAt = metadata.linkNonceIssuedAt ?? cookieState.issuedAt;
        metadata.linkNonceSignature = metadata.linkNonceSignature ?? cookieState.signature;
    }

    const linkNonce = toOptionalString(metadata.linkNonce);
    const linkMode = toOptionalString(metadata.linkMode);
    const linkUserId = cookieState?.userId ?? user.id;
    const linkingAuthorized = validateLinkSignature(
        linkUserId,
        toOptionalString(metadata.linkNonce),
        metadata.linkNonceIssuedAt,
        toOptionalString(metadata.linkNonceSignature),
    );
    console.log('[oauth] account metadata for link', {
        providerId,
        userId: user.id,
        linkUserId,
        linkMode,
        hasNonce: Boolean(linkNonce),
        nonceIssuedAt: metadata.linkNonceIssuedAt,
        hasSignature: Boolean(metadata.linkNonceSignature),
        linkingAuthorized,
    });

    const existingLink = await findOAuthAccountLink(normalizedProvider, providerAccountId);
    let autoLinkAuthorized = false;
    if (!linkingAuthorized && (!existingLink || existingLink.user_id !== user.id)) {
        autoLinkAuthorized = await isAutoLinkEnabledForTenant(
            typeof user.tenant === "string" ? user.tenant : undefined,
            (user.user_type as "internal" | "client") || "internal",
        );
    }
    if (!linkingAuthorized && !autoLinkAuthorized) {
        // Skip linking when not authorized and auto-linking is disabled.
        return;
    }

    const { linkNonceIssuedAt, linkNonceSignature, ...metadataForStorage } = metadata;

    const finalMetadata = {
        ...metadataForStorage,
        linkMode: linkingAuthorized
            ? linkMode ?? 'link'
            : autoLinkAuthorized
            ? 'auto-link'
            : linkMode ?? 'login',
        linkNonce: linkingAuthorized ? linkNonce : undefined,
    };

    try {
        await upsertOAuthAccountLink({
            tenant: user.tenant,
            userId: linkUserId,
            provider: normalizedProvider,
            providerAccountId,
            providerEmail: user.email,
            metadata: finalMetadata,
        });
    } catch (error) {
        if (error instanceof OAuthAccountLinkConflictError) {
            console.warn('[oauth] account already linked to another user', {
                providerId,
                providerAccountId,
                userId: user.id,
            });
            return;
        }

        console.warn('[oauth] failed to persist account link', {
            providerId,
            providerAccountId,
            userId: user.id,
            error,
        });
    }
}

// Helper function to get OAuth secrets from secret provider with env fallback
async function getOAuthSecrets() {
    const { getSecretProviderInstance } = await import('@alga-psa/shared/core/secretProvider');
    const secretProvider = await getSecretProviderInstance();

    const [
        googleClientId,
        googleClientSecret,
        keycloakClientId,
        keycloakClientSecret,
        keycloakUrl,
        keycloakRealm,
        microsoftClientId,
        microsoftClientSecret,
        microsoftTenantId,
        microsoftAuthority,
    ] = await Promise.all([
        secretProvider.getAppSecret('GOOGLE_OAUTH_CLIENT_ID'),
        secretProvider.getAppSecret('GOOGLE_OAUTH_CLIENT_SECRET'),
        secretProvider.getAppSecret('KEYCLOAK_CLIENT_ID'),
        secretProvider.getAppSecret('KEYCLOAK_CLIENT_SECRET'),
        secretProvider.getAppSecret('KEYCLOAK_URL'),
        secretProvider.getAppSecret('KEYCLOAK_REALM'),
        secretProvider.getAppSecret('MICROSOFT_OAUTH_CLIENT_ID'),
        secretProvider.getAppSecret('MICROSOFT_OAUTH_CLIENT_SECRET'),
        secretProvider.getAppSecret('MICROSOFT_OAUTH_TENANT_ID'),
        secretProvider.getAppSecret('MICROSOFT_OAUTH_AUTHORITY'),
    ]);

    return {
        googleClientId: googleClientId || process.env.GOOGLE_OAUTH_CLIENT_ID || '',
        googleClientSecret: googleClientSecret || process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
        keycloakClientId: keycloakClientId || process.env.KEYCLOAK_CLIENT_ID || '',
        keycloakClientSecret: keycloakClientSecret || process.env.KEYCLOAK_CLIENT_SECRET || '',
        keycloakUrl: keycloakUrl || process.env.KEYCLOAK_URL || '',
        keycloakRealm: keycloakRealm || process.env.KEYCLOAK_REALM || '',
        microsoftClientId: microsoftClientId || process.env.MICROSOFT_OAUTH_CLIENT_ID || '',
        microsoftClientSecret: microsoftClientSecret || process.env.MICROSOFT_OAUTH_CLIENT_SECRET || '',
        microsoftTenantId: microsoftTenantId || process.env.MICROSOFT_OAUTH_TENANT_ID || '',
        microsoftAuthority: microsoftAuthority || process.env.MICROSOFT_OAUTH_AUTHORITY || '',
    };
}

// Build NextAuth options dynamically with secrets
export async function buildAuthOptions(): Promise<NextAuthConfig> {
    const secrets = await getOAuthSecrets();
    const nextAuthSecret = await getNextAuthSecret();

    return {
    trustHost: true,
    secret: nextAuthSecret,
    providers: [
        ...(isEnterprise && secrets.googleClientId && secrets.googleClientSecret
            ? [
                GoogleProvider({
                    clientId: secrets.googleClientId,
                    clientSecret: secrets.googleClientSecret,
                    profile: async (profile): Promise<ExtendedUser> => {
                        const googleProfile = profile as Record<string, unknown>;
                        const tenantHint =
                            typeof googleProfile.hd === 'string' ? googleProfile.hd : undefined;
                        const userTypeHint =
                            typeof googleProfile.user_type === 'string'
                                ? googleProfile.user_type
                                : undefined;
                        const vanityHostHint =
                            typeof googleProfile.vanity_host === 'string'
                                ? googleProfile.vanity_host
                                : undefined;
                        return mapOAuthProfileToExtendedUser({
                            provider: 'google',
                            email: profile.email,
                            image: profile.picture,
                            profile,
                            tenantHint,
                            vanityHostHint,
                            userTypeHint,
                        }) as Promise<ExtendedUser>;
                    },
                }),
            ]
            : []),
        ...(isEnterprise && secrets.microsoftClientId && secrets.microsoftClientSecret
            ? [
                AzureADProvider({
                    clientId: secrets.microsoftClientId,
                    clientSecret: secrets.microsoftClientSecret,
                    // Always use 'common' for multi-tenant Azure AD apps
                    issuer: `https://login.microsoftonline.com/common/v2.0`,
                    checks: ['pkce', 'state'],
                    profile: async (profile: Record<string, any>): Promise<ExtendedUser> => {
                        const emailCandidate =
                            profile.email ??
                            profile.mail ??
                            profile.preferred_username ??
                            profile.userPrincipalName;
                        const tenantHint =
                            typeof profile.tenant === 'string'
                                ? profile.tenant
                                : typeof profile.tenantId === 'string'
                                ? profile.tenantId
                                : typeof profile.tid === 'string'
                                ? profile.tid
                                : typeof profile.domain === 'string'
                                ? profile.domain
                                : undefined;
                        const vanityHostHint =
                            typeof profile.vanity_host === 'string' ? profile.vanity_host : undefined;
                        const userTypeHint =
                            typeof profile.user_type === 'string' ? profile.user_type : undefined;
                        return mapOAuthProfileToExtendedUser({
                            provider: 'microsoft',
                            email: typeof emailCandidate === 'string' ? emailCandidate : undefined,
                            image: profile.picture ?? profile.photo ?? undefined,
                            profile,
                            tenantHint,
                            vanityHostHint,
                            userTypeHint,
                        }) as Promise<ExtendedUser>;
                    },
                }),
            ]
            : []),
        CredentialsProvider({
            name: "Credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
                twoFactorCode: { label: "2FA Code", type: "text" },
                userType: { label: "User Type", type: "text" },
                tenant: { label: "Tenant", type: "text" },
            },
            async authorize(credentials, request): Promise<ExtendedUser | null> {
                const { getAdminConnection } = await import("@shared/db/admin");
                const logger = (await import('@alga-psa/shared/core/logger')).default;
                const { authenticateUser } = await import('server/src/lib/actions/auth');
                console.log('==== Starting Credentials OAuth Authorization ====');
                console.log('Received credentials:', {
                    email: credentials?.email,
                    hasPassword: !!credentials?.password,
                    hasTwoFactorCode: !!credentials?.twoFactorCode
                });
                logger.info("Starting Credentials OAuth")
                try {
                    const tenantSlug = typeof credentials?.tenant === 'string'
                        ? credentials.tenant.trim().toLowerCase()
                        : undefined;

                    if (tenantSlug && !isValidTenantSlug(tenantSlug)) {
                        logger.warn("Invalid tenant slug provided", {
                            email: credentials?.email,
                            tenantSlug,
                        });
                        return null;
                    }

                    logger.debug("Authorizing email", credentials?.email);
                    if (!credentials?.email || !credentials.password) {
                        console.log('Authentication failed: Missing credentials');
                        logger.warn("Missing credentials");
                        return null;
                    }

                    console.log('Attempting to authenticate user:', credentials.email);
                    console.log('user type', credentials.userType);
                    console.log('next auth secret', process.env.NEXTAUTH_SECRET);
                    const user = await authenticateUser(
                        credentials.email as string,
                        credentials.password as string,
                        credentials.userType as string,
                        {
                            tenantSlug,
                            requireTenantMatch: Boolean(tenantSlug),
                        }
                    );
                    if (!user) {
                        console.log('Authentication failed: No user returned');
                        return null;
                    }
                    if (credentials.userType && user.user_type !== credentials.userType) {
                        console.log('Authentication failed: User type mismatch', { expected: credentials.userType, actual: user.user_type });
                        return null;
                    }
                    console.log('User authenticated successfully:', {
                        userId: user.user_id,
                        userType: user.user_type,
                        hasTwoFactor: user.two_factor_enabled
                    });

                    // If it's a client user, get the contact and client information
                    let clientId: string | undefined = undefined;
                    if (user.user_type === 'client' && user.contact_id) {
                        console.log('Processing client user with contact_id:', user.contact_id);
                      const connection = await getAdminConnection();
                        console.log('Database connection established');

                        const contact = await connection('contacts')
                            .where({
                                contact_name_id: user.contact_id,
                          tenant: user.tenant
                        })
                        .first();

                        console.log('Contact lookup result:', {
                            found: !!contact,
                            contactId: user.contact_id,
                            tenant: user.tenant
                        });
                        if (contact) {
                            clientId = contact.client_id || undefined;
                            console.log('Client information found:', { clientId });
                            logger.info(`Found client ${clientId} for contact ${user.contact_id}`);
                        } else {
                            console.log('No client information found for contact');
                            logger.warn(`No contact found for user ${user.email} with contact_id ${user.contact_id}`);
                    }
                    }

                    // 2FA Verification with device recognition
                    if (user.two_factor_enabled) {
                        console.log('2FA is enabled for user, checking device recognition');

                        let shouldRequire2FA = true;

                        // Check if device-based 2FA skip is enabled
                        if ((user as any).two_factor_required_new_device && request) {
                            try {
                                // Generate device fingerprint from request
                                const userAgent = (request as any).headers?.get?.('user-agent') || 'unknown';
                                const deviceFingerprint = generateDeviceFingerprint(userAgent);

                                // Check if this device is known
                                const isKnown = await UserSession.isKnownDevice(
                                    user.tenant,
                                    user.user_id.toString(),
                                    deviceFingerprint
                                );

                                console.log('Device recognition check:', {
                                    deviceFingerprint,
                                    isKnownDevice: isKnown
                                });

                                // Skip 2FA for known devices
                                if (isKnown) {
                                    shouldRequire2FA = false;
                                    console.log('Device recognized, skipping 2FA verification');
                                }
                            } catch (error) {
                                console.error('Device recognition check failed, falling back to 2FA:', error);
                                // On error, require 2FA for security
                                shouldRequire2FA = true;
                            }
                        }

                        if (shouldRequire2FA) {
                            console.log('2FA verification required, starting verification');
                            if (!credentials.twoFactorCode) {
                                console.log('2FA verification failed: No code provided');
                                logger.warn("2FA code required for email", credentials.email);
                                return null;
                            }
                            if (!user.two_factor_secret) {
                                console.log('2FA verification failed: No secret found');
                                logger.warn("2FA secret not found for email", credentials.email);
                                return null;
                            }
                            console.log('Verifying 2FA code');
                            const { verifyAuthenticator } = await import('server/src/utils/authenticator/authenticator');
                            const isValid2FA = await verifyAuthenticator(credentials.twoFactorCode as string, user.two_factor_secret);
                            console.log('2FA verification result:', { isValid: isValid2FA });
                            if (!isValid2FA) {
                                console.log('2FA verification failed: Invalid code');
                                logger.warn("Invalid 2FA code for email", credentials.email);
                                return null;
                            }
                            console.log('2FA verification successful');
                        }
                    }

                    logger.info("User sign in successful with email", credentials.email);
                    const tenantSlugForUser = user.tenant ? buildTenantPortalSlug(user.tenant) : undefined;
                    const userResponse: ExtendedUser = {
                        id: user.user_id.toString(),
                        email: user.email,
                        username: user.username,
                        image: user.image || '/image/avatar-purple-big.png',
                        name: `${user.first_name} ${user.last_name}`,
                        proToken: '',
                        tenant: user.tenant,
                        user_type: user.user_type,
                        clientId: clientId ?? undefined,
                        contactId: user.contact_id,
                        tenantSlug: tenantSlugForUser,
                    };

                    // NEW: Capture device information for session tracking
                    if (request) {
                        try {
                            const ip = getClientIp(request as any);
                            const userAgent = (request as any).headers?.get?.('user-agent') || 'unknown';
                            const deviceFingerprint = generateDeviceFingerprint(userAgent);
                            const deviceInfo = getDeviceInfo(userAgent);

                            // Enforce platform-level max sessions (hardcoded for security)
                            const MAX_SESSIONS = 5; // Platform security policy
                            await UserSession.enforceMaxSessions(userResponse.tenant!, userResponse.id, MAX_SESSIONS);

                            userResponse.deviceInfo = {
                                ip,
                                userAgent,
                                deviceFingerprint,
                                deviceName: deviceInfo.name,
                                deviceType: deviceInfo.type,
                                locationData: null,
                            };

                            // Set login method for credentials provider
                            userResponse.loginMethod = 'credentials';

                            console.log('[auth] Device info captured in Credentials provider:', {
                                ip,
                                deviceName: deviceInfo.name,
                                deviceType: deviceInfo.type
                            });
                        } catch (error) {
                            console.error('[auth] Failed to capture device info:', error);
                        }
                    }

                    console.log('Authorization successful. Returning user data:', {
                        id: userResponse.id,
                        email: userResponse.email,
                        username: userResponse.username,
                        userType: userResponse.user_type,
                        tenant: userResponse.tenant,
                        hasDeviceInfo: !!userResponse.deviceInfo
                    });
                    console.log('==== Credentials OAuth Authorization Complete ====');
                    return userResponse;
                } catch (error) {
                    console.log('==== Authorization Error ====');
                    console.error('Error details:', {
                        email: credentials?.email
                    });
                    logger.warn("Error authorizing email", credentials?.email, error);
                    throw error;
                }
            }
        }),
        ...(secrets.keycloakClientId &&
        secrets.keycloakClientSecret &&
        secrets.keycloakUrl &&
        secrets.keycloakRealm
            ? [
                KeycloakProvider({
                    clientId: secrets.keycloakClientId,
                    clientSecret: secrets.keycloakClientSecret,
                    issuer: `${secrets.keycloakUrl}/realms/${secrets.keycloakRealm}`,
                    profile: async (profile): Promise<ExtendedUser> => {
                        const logger = (await import('@alga-psa/shared/core/logger')).default;
                        logger.info("Starting Keycloak OAuth");
                        return {
                            id: profile.sub,
                            name: profile.name ?? profile.preferred_username,
                            email: profile.email,
                            image: profile.picture,
                            username: profile.preferred_username,
                            proToken: '',
                            tenant: profile.tenant,
                            user_type: profile.user_type,
                            clientId: profile.clientId,
                        };
                    },
                }),
            ]
            : []),
        // CredentialsProvider({
        //     id: "keycloak-credentials",
        //     name: "Keycloak-credentials",
        //     credentials: {
        //         email: { label: "Email", type: "email" },
        //         password: { label: "Password", type: "password" },
        //         twoFactorCode: { label: "2FA Code", type: "text" },
        //     },
        //     async authorize(credentials): Promise<ExtendedUser | null> {
        //         logger.info("Starting Keycloak Credentials OAuth")
        //         if (!credentials?.email || !credentials.password) {
        //             throw new Error("Missing username or password");
        //         }
        //         const user = await User.findUserByEmail(credentials.email);
        //         if (!user || !user.user_id) {
        //             logger.warn("User not found with email", credentials.email);
        //             throw new Error("User not found");
        //         }
        //         if (!user) { return null; }
        //         if (user.two_factor_enabled) {
        //             if (!credentials.twoFactorCode) {
        //                 logger.warn("2FA code required for email", credentials.email);
        //                 return null;
        //             }
        //             if (!user.two_factor_secret) {
        //                 logger.warn("2FA secret not found for email", credentials.email);
        //                 return null;
        //             }
        //             const isValid2FA = await verifyAuthenticator(credentials.twoFactorCode, user.two_factor_secret);
        //             if (!isValid2FA) {
        //                 logger.warn("Invalid 2FA code for email", credentials.email);
        //                 return null;
        //             }
        //         }

        //         try {
        //             // Get token from Keycloak
        //             const tokenData = await getKeycloakToken(user.username, credentials.password);
        //             logger.info("Token Data:", tokenData);
        //             if (!tokenData || !tokenData.access_token) {
        //                 return null;
        //             }
        //             const tokenInfo = decodeToken(tokenData.access_token);
        //             if (!tokenInfo) {
        //                 return null;
        //             }

        //             if (tokenInfo.email !== credentials.email) {
        //                 return null;
        //             }
        //             return {
        //                 id: user.user_id.toString(),
        //                 email: user.email,
        //                 username: user.username,
        //                 image: user.image || '/image/avatar-purple-big.png',
        //                 name: `${user.first_name} ${user.last_name}`,
        //                 proToken: tokenData.access_token,
        //                 tenant: user.tenant,
        //                 user_type: user.user_type
        //             };
        //         } catch (error) {
        //             logger.error("Failed to authenticate with Keycloak:", error);
        //             return null;
        //         }
        //     },
        // }),
    ],
    pages: {
        signIn: '/auth/signin', // This will redirect to the appropriate page
        signOut: '/auth/signin', // After sign out, go to the redirect page
    },
    session: {
        strategy: "jwt",
        maxAge: SESSION_MAX_AGE,
    },
    cookies: {
        sessionToken: SESSION_COOKIE,
    },
    callbacks: {
        async signIn({ user, account, credentials, profile, ...context }) {
            const providerId = account?.provider;
            const extendedUser = user as ExtendedUser | undefined;
            const request = (context as any).request; // NextAuth v5 runtime provides request

            if (extendedUser && providerId && providerId !== 'credentials') {
                const accountRecord = account as unknown as Record<string, unknown> | null;
                try {
                    const enrichedUser = await applyOAuthAccountHints(
                        toOAuthProfileMappingResult(extendedUser),
                        accountRecord,
                    );
                    Object.assign(extendedUser, enrichedUser);
                } catch (error) {
                    console.warn('[signIn] failed to apply OAuth tenant hints', {
                        providerId,
                        error,
                    });
                }

                await ensureOAuthAccountLink(extendedUser, accountRecord, providerId);
            }

            // Track last login
            if (extendedUser?.id && extendedUser?.tenant && providerId) {
                try {
                    const User = (await import('server/src/lib/models/user')).default;
                    // Note: IP address would need to be passed from request headers
                    await User.updateLastLogin(
                        extendedUser.id,
                        extendedUser.tenant,
                        providerId
                    );
                } catch (error) {
                    console.warn('[signIn] failed to update last login', error);
                }
            }

            if (providerId === 'credentials') {
                const callbackUrl = typeof credentials?.callbackUrl === 'string' ? credentials.callbackUrl : undefined;
                const canonicalBaseUrl = process.env.NEXTAUTH_URL;

                console.log('[signIn] credentials outcome', {
                    email: extendedUser?.email,
                    tenant: extendedUser?.tenant,
                    userType: extendedUser?.user_type,
                    hasCallback: Boolean(callbackUrl),
                    canonicalBaseUrl,
                });

                if (extendedUser?.user_type === 'client' && callbackUrl && canonicalBaseUrl) {
                    try {
                        console.log('[signIn] computing vanity redirect', {
                            email: extendedUser.email,
                            tenant: extendedUser.tenant,
                            callbackUrl,
                            canonicalBaseUrl,
                        });
                        const vanityRedirect = await computeVanityRedirect({
                            url: callbackUrl,
                            baseUrl: canonicalBaseUrl,
                            token: {
                                id: extendedUser.id,
                                email: extendedUser.email,
                                name: extendedUser.name,
                                tenant: extendedUser.tenant,
                                tenantSlug: extendedUser.tenantSlug,
                                user_type: extendedUser.user_type,
                                clientId: extendedUser.clientId,
                                contactId: extendedUser.contactId,
                            },
                        });

                        if (vanityRedirect) {
                            console.log('[signIn] returning vanity redirect', {
                                redirect: vanityRedirect,
                            });
                            return vanityRedirect;
                        }
                    } catch (error) {
                        console.warn('[signIn] failed to compute client portal redirect', {
                            email: extendedUser.email,
                            tenant: extendedUser.tenant,
                            callbackUrl,
                            error,
                        });
                    }
                }
            }

            // NEW: Capture device information for session tracking
            if (extendedUser && request) {
                try {
                    const ip = getClientIp(request as any);
                    const userAgent = (request as any).headers?.get?.('user-agent') || 'unknown';
                    const deviceFingerprint = generateDeviceFingerprint(userAgent);
                    const deviceInfo = getDeviceInfo(userAgent);

                    // Enforce platform-level max sessions (hardcoded for security)
                    // This prevents account sharing and is not configurable
                    if (extendedUser.tenant && extendedUser.id) {
                        const MAX_SESSIONS = 5; // Platform security policy
                        await UserSession.enforceMaxSessions(extendedUser.tenant, extendedUser.id, MAX_SESSIONS);
                    }

                    // Store device info in user object for jwt callback
                    extendedUser.deviceInfo = {
                        ip,
                        userAgent,
                        deviceFingerprint,
                        deviceName: deviceInfo.name,
                        deviceType: deviceInfo.type,
                        locationData: null, // Will be fetched async in jwt callback
                    };

                    // Capture login method from OAuth provider
                    if (account?.provider) {
                        (extendedUser as any).loginMethod = account.provider;
                    }
                } catch (error) {
                    console.error('[auth] Session tracking error:', error);
                    // Don't block login on session tracking errors
                }
            }

            return true; // Allow sign in
        },
        async jwt({ token, user }) {
            console.log('JWT callback - initial token:', {
                id: token.id,
                email: token.email,
                clientId: token.clientId,
                hasUser: !!user
            });

            if (user) {
                const extendedUser = user as ExtendedUser;
                console.log('JWT callback - new user login:', {
                    id: extendedUser.id,
                    email: extendedUser.email,
                    tenant: extendedUser.tenant,
                    clientId: extendedUser.clientId
                });
                if (!extendedUser.tenantSlug && extendedUser.tenant) {
                    extendedUser.tenantSlug = buildTenantPortalSlug(extendedUser.tenant);
                }
                token.id = extendedUser.id;
                token.email = extendedUser.email;
                token.name = extendedUser.name;
                token.username = extendedUser.username;
                token.image = extendedUser.image;
                token.proToken = extendedUser.proToken;
                token.tenant = extendedUser.tenant;
                token.tenantSlug = extendedUser.tenantSlug;
                token.user_type = extendedUser.user_type;
                token.clientId = extendedUser.clientId;
                token.contactId = extendedUser.contactId;
              }

            // NEW: Create session record on initial sign-in
            // CRITICAL: Only create if session_id doesn't exist (prevents duplicates on OTT redemption)
            if ((user as any)?.deviceInfo && !token.session_id) {
                try {
                    const extendedUser = user as any; // ExtendedUser with deviceInfo and loginMethod added in signIn callback
                    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000);

                    // Determine login method - use captured provider from signIn, or default to credentials
                    const loginMethod = extendedUser.loginMethod || (token.login_method as string | undefined) || 'credentials';

                    const sessionId = await UserSession.create({
                        tenant: token.tenant as string,
                        user_id: token.id as string,
                        ip_address: extendedUser.deviceInfo.ip,
                        user_agent: extendedUser.deviceInfo.userAgent,
                        device_fingerprint: extendedUser.deviceInfo.deviceFingerprint,
                        device_name: extendedUser.deviceInfo.deviceName,
                        device_type: extendedUser.deviceInfo.deviceType,
                        location_data: extendedUser.deviceInfo.locationData,
                        expires_at: expiresAt,
                        login_method: loginMethod,
                    });

                    token.session_id = sessionId;
                    token.login_method = loginMethod;

                    // Fire-and-forget: Update location data asynchronously
                    const ipForLocation = extendedUser.deviceInfo.ip;
                    const tenantForLocation = token.tenant as string;
                    getLocationFromIp(ipForLocation)
                        .then((locationData) => {
                            if (locationData) {
                                return UserSession.updateLocation(tenantForLocation, sessionId, locationData);
                            }
                        })
                        .catch((error) => {
                            console.warn('[auth] Failed to update session location:', error);
                        });

                    // Clean up device info (don't store in token)
                    delete (user as any).deviceInfo;
                } catch (error) {
                    console.error('[auth] Failed to create session record:', error);
                }
            }

            // NEW: Check if session was revoked (throttled to reduce DB load)
            // PERFORMANCE FIX: Only check revocation every 30 seconds, with in-memory cache
            // REMOVED updateActivity() - it was called every 60s per user, exhausting connection pool
            // Activity tracking is not critical and can be updated less frequently via background job
            if (token.session_id) {
                try {
                    const lastRevocationCheck = token.last_revocation_check as number || 0;
                    const now = Date.now();
                    const shouldCheckRevocation = now - lastRevocationCheck > 30000; // 30 seconds

                    if (shouldCheckRevocation) {
                        const isRevoked = await UserSession.isRevoked(
                            token.tenant as string,
                            token.session_id as string
                        );

                        if (isRevoked) {
                            console.log('[auth] Session revoked, forcing logout:', token.session_id);
                            return null; // This will force a logout
                        }

                        token.last_revocation_check = now;
                    }
                } catch (error) {
                    console.error('[auth] Session revocation check error:', error);
                    // Don't block on session check errors
                }
            }

            // PERFORMANCE FIX: Removed validateUser() which was causing connection pool exhaustion
            // - validateUser() called getAdminConnection() on EVERY request (250+ times in logs)
            // - With max 20 connections, pool exhausted instantly with multiple users
            // - Result: "remaining connection slots reserved for superuser" errors
            //
            // Security is maintained by:
            // 1. NextAuth JWT signature validation (cryptographically secure)
            // 2. Session revocation check above (handles compromised sessions)
            // 3. User validation at login time (sufficient for most use cases)
            //
            // If user is deleted/deactivated between requests, they'll be caught at next login

            const result = {
                ...token
                // Token already contains all necessary user data from initial sign-in
                // No need to fetch from DB on every request
            };

            console.log('JWT callback - final token:', {
                id: result.id,
                email: result.email,
                tenant: result.tenant,
                tenantSlug: result.tenantSlug,
                clientId: result.clientId
            });

            return result;
        },
        async session({ session, token }) {
            if (token.error === "TokenValidationError") {
                // If there was an error during token validation, return a special session
                return { expires: "0" };
            }

            const logger = (await import('@alga-psa/shared/core/logger')).default;
            logger.debug("Session Token:", token);
            console.log('Session callback - token:', {
                id: token.id,
                email: token.email,
                tenant: token.tenant,
                tenantSlug: token.tenantSlug,
                user_type: token.user_type,
                clientId: token.clientId,
                contactId: token.contactId
            });

            if (token && session.user) {
                const user = session.user as ExtendedUser;
                // CRITICAL: Ensure id is always set
                if (!token.id) {
                    logger.error('Token missing id field!', { token });
                    console.error('CRITICAL: Token missing id field!', token);
                }
                user.id = token.id as string || token.sub as string || ''; // Fallback to sub if id is missing
                user.email = token.email || '';
                user.name = token.name || '';
                user.username = token.username as string;
                user.image = token.image as string;
                user.proToken = token.proToken as string;
                user.tenant = token.tenant as string;
                user.tenantSlug = token.tenantSlug as string | undefined;
                user.user_type = token.user_type as string;
                user.clientId = token.clientId as string;
                user.contactId = token.contactId as string;
            }
            logger.trace("Session Object:", session);
            console.log('Session callback - final session.user:', {
                id: session.user?.id,
                email: session.user?.email,
                tenant: session.user?.tenant,
                clientId: session.user?.clientId
            });

            // NEW: Add session_id to session object
            if (token.session_id) {
                (session as any).session_id = token.session_id as string;
            }
            if (token.login_method) {
                (session as any).login_method = token.login_method as string;
            }

            return session;
        },
        async redirect({ url, baseUrl }) {
            if (url.includes('/auth/client-portal/handoff')) {
                return url;
            }

            console.log('[redirect]');
            const vanityUrl = await computeVanityRedirect({ url, baseUrl, token: null });
            // if the url doesn't include the host, add it
            if (url.startsWith('/')) {
                return process.env.NEXTAUTH_URL + url;
            }
            return vanityUrl ?? url;
        },
    },
    };
}

// For backward compatibility, create a cached instance
let cachedOptions: NextAuthConfig | null = null;

export async function getAuthOptions(): Promise<NextAuthConfig> {
    if (!cachedOptions) {
        cachedOptions = await buildAuthOptions();
    }
    return cachedOptions;
}

// Synchronous fallback that uses environment variables
export const options: NextAuthConfig = {
    trustHost: true,
    secret: getNextAuthSecretSync(),
    providers: [
        ...(isEnterprise &&
        process.env.GOOGLE_OAUTH_CLIENT_ID &&
        process.env.GOOGLE_OAUTH_CLIENT_SECRET
            ? [
                GoogleProvider({
                    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID as string,
                    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET as string,
                    profile: async (profile): Promise<ExtendedUser> => {
                        const googleProfile = profile as Record<string, unknown>;
                        const tenantHint =
                            typeof googleProfile.hd === 'string' ? googleProfile.hd : undefined;
                        const userTypeHint =
                            typeof googleProfile.user_type === 'string'
                                ? googleProfile.user_type
                                : undefined;
                        const vanityHostHint =
                            typeof googleProfile.vanity_host === 'string'
                                ? googleProfile.vanity_host
                                : undefined;
                        return mapOAuthProfileToExtendedUser({
                            provider: 'google',
                            email: profile.email,
                            image: (profile as any).picture,
                            profile,
                            tenantHint,
                            vanityHostHint,
                            userTypeHint,
                        }) as Promise<ExtendedUser>;
                    },
                }),
            ]
            : []),
        ...(isEnterprise &&
        process.env.MICROSOFT_OAUTH_CLIENT_ID &&
        process.env.MICROSOFT_OAUTH_CLIENT_SECRET
            ? [
                AzureADProvider({
                    clientId: process.env.MICROSOFT_OAUTH_CLIENT_ID as string,
                    clientSecret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET as string,
                    // Always use 'common' for multi-tenant Azure AD apps
                    issuer: `https://login.microsoftonline.com/common/v2.0`,
                    profile: async (profile: Record<string, any>): Promise<ExtendedUser> => {
                        const emailCandidate =
                            profile.email ??
                            profile.mail ??
                            profile.preferred_username ??
                            profile.userPrincipalName;
                        const tenantHint =
                            typeof profile.tenant === 'string'
                                ? profile.tenant
                                : typeof profile.tenantId === 'string'
                                ? profile.tenantId
                                : typeof profile.tid === 'string'
                                ? profile.tid
                                : typeof profile.domain === 'string'
                                ? profile.domain
                                : undefined;
                        const vanityHostHint =
                            typeof profile.vanity_host === 'string' ? profile.vanity_host : undefined;
                        const userTypeHint =
                            typeof profile.user_type === 'string' ? profile.user_type : undefined;
                        return mapOAuthProfileToExtendedUser({
                            provider: 'microsoft',
                            email: typeof emailCandidate === 'string' ? emailCandidate : undefined,
                            image: profile.picture ?? profile.photo ?? undefined,
                            profile,
                            tenantHint,
                            vanityHostHint,
                            userTypeHint,
                        }) as Promise<ExtendedUser>;
                    },
                }),
            ]
            : []),
        CredentialsProvider({
            name: "Credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
                twoFactorCode: { label: "2FA Code", type: "text" },
                userType: { label: "User Type", type: "text" },
                tenant: { label: "Tenant", type: "text" },
            },
            async authorize(credentials, request): Promise<ExtendedUser | null> {
                const { getAdminConnection } = await import("@shared/db/admin");
                const { authenticateUser } = await import('server/src/lib/actions/auth');
                const logger = { info: (..._a:any[])=>{}, warn: (..._a:any[])=>{}, debug: (..._a:any[])=>{}, trace: (..._a:any[])=>{}, error: (..._a:any[])=>{} };
                console.log('==== Starting Credentials OAuth Authorization ====');
                console.log('Received credentials:', {
                    email: credentials?.email,
                    hasPassword: !!credentials?.password,
                    hasTwoFactorCode: !!credentials?.twoFactorCode
                });
                logger.info("Starting Credentials OAuth")
                try {
                    const tenantSlug = typeof credentials?.tenant === 'string'
                        ? credentials.tenant.trim().toLowerCase()
                        : undefined;

                    if (tenantSlug && !isValidTenantSlug(tenantSlug)) {
                        logger.warn("Invalid tenant slug provided", {
                            email: credentials?.email,
                            tenantSlug,
                        });
                        return null;
                    }

                    logger.debug("Authorizing email", credentials?.email);
                    if (!credentials?.email || !credentials.password) {
                        console.log('Authentication failed: Missing credentials');
                        logger.warn("Missing credentials");
                        return null;
                    }

                    console.log('Attempting to authenticate user:', credentials.email);
                    const user = await authenticateUser(
                        credentials.email as string,
                        credentials.password as string,
                        credentials.userType as string,
                        {
                            tenantSlug,
                            requireTenantMatch: Boolean(tenantSlug),
                        }
                    );
                    if (!user) {
                        console.log('Authentication failed: No user returned');
                        return null;
                    }
                    if (credentials.userType && user.user_type !== credentials.userType) {
                        console.log('Authentication failed: User type mismatch', { expected: credentials.userType, actual: user.user_type });
                        return null;
                    }
                    console.log('User authenticated successfully:', {
                        userId: user.user_id,
                        userType: user.user_type,
                        hasTwoFactor: user.two_factor_enabled
                    });

                    // If it's a client user, get the contact and client information
                    let clientId: string | undefined = undefined;
                    if (user.user_type === 'client' && user.contact_id) {
                        console.log('Processing client user with contact_id:', user.contact_id);
                      const connection = await getAdminConnection();
                        console.log('Database connection established');

                        const contact = await connection('contacts')
                            .where({
                                contact_name_id: user.contact_id,
                          tenant: user.tenant
                        })
                        .first();

                        console.log('Contact lookup result:', {
                            found: !!contact,
                            contactId: user.contact_id,
                            tenant: user.tenant
                        });
                        if (contact) {
                            clientId = contact.client_id || undefined;
                            console.log('Client information found:', { clientId });
                            logger.info(`Found client ${clientId} for contact ${user.contact_id}`);
                        } else {
                            console.log('No client information found for contact');
                            logger.warn(`No contact found for user ${user.email} with contact_id ${user.contact_id}`);
                    }
                    }

                    // 2FA Verification with device recognition
                    if (user.two_factor_enabled) {
                        console.log('2FA is enabled for user, checking device recognition');

                        let shouldRequire2FA = true;

                        // Check if device-based 2FA skip is enabled
                        if ((user as any).two_factor_required_new_device && request) {
                            try {
                                // Generate device fingerprint from request
                                const userAgent = (request as any).headers?.get?.('user-agent') || 'unknown';
                                const deviceFingerprint = generateDeviceFingerprint(userAgent);

                                // Check if this device is known
                                const isKnown = await UserSession.isKnownDevice(
                                    user.tenant,
                                    user.user_id.toString(),
                                    deviceFingerprint
                                );

                                console.log('Device recognition check:', {
                                    deviceFingerprint,
                                    isKnownDevice: isKnown
                                });

                                // Skip 2FA for known devices
                                if (isKnown) {
                                    shouldRequire2FA = false;
                                    console.log('Device recognized, skipping 2FA verification');
                                }
                            } catch (error) {
                                console.error('Device recognition check failed, falling back to 2FA:', error);
                                // On error, require 2FA for security
                                shouldRequire2FA = true;
                            }
                        }

                        if (shouldRequire2FA) {
                            console.log('2FA verification required, starting verification');
                            if (!credentials.twoFactorCode) {
                                console.log('2FA verification failed: No code provided');
                                logger.warn("2FA code required for email", credentials.email);
                                return null;
                            }
                            if (!user.two_factor_secret) {
                                console.log('2FA verification failed: No secret found');
                                logger.warn("2FA secret not found for email", credentials.email);
                                return null;
                            }
                            console.log('Verifying 2FA code');
                            const { verifyAuthenticator } = await import('server/src/utils/authenticator/authenticator');
                            const isValid2FA = await verifyAuthenticator(credentials.twoFactorCode as string, user.two_factor_secret);
                            console.log('2FA verification result:', { isValid: isValid2FA });
                            if (!isValid2FA) {
                                console.log('2FA verification failed: Invalid code');
                                logger.warn("Invalid 2FA code for email", credentials.email);
                                return null;
                            }
                            console.log('2FA verification successful');
                        }
                    }

                    logger.info("User sign in successful with email", credentials.email);
                    const tenantSlugForUser = user.tenant ? buildTenantPortalSlug(user.tenant) : undefined;
                    const userResponse: ExtendedUser = {
                        id: user.user_id.toString(),
                        email: user.email,
                        username: user.username,
                        image: user.image || '/image/avatar-purple-big.png',
                        name: `${user.first_name} ${user.last_name}`,
                        proToken: '',
                        tenant: user.tenant,
                        user_type: user.user_type,
                        clientId: clientId,
                        contactId: user.contact_id,
                        tenantSlug: tenantSlugForUser,
                    };

                    // NEW: Capture device information for session tracking
                    if (request) {
                        try {
                            const ip = getClientIp(request as any);
                            const userAgent = (request as any).headers?.get?.('user-agent') || 'unknown';
                            const deviceFingerprint = generateDeviceFingerprint(userAgent);
                            const deviceInfo = getDeviceInfo(userAgent);

                            // Enforce platform-level max sessions (hardcoded for security)
                            const MAX_SESSIONS = 5; // Platform security policy
                            await UserSession.enforceMaxSessions(userResponse.tenant!, userResponse.id, MAX_SESSIONS);

                            userResponse.deviceInfo = {
                                ip,
                                userAgent,
                                deviceFingerprint,
                                deviceName: deviceInfo.name,
                                deviceType: deviceInfo.type,
                                locationData: null,
                            };

                            // Set login method for credentials provider
                            userResponse.loginMethod = 'credentials';

                            console.log('[auth] Device info captured in Credentials provider (Client Portal):', {
                                ip,
                                deviceName: deviceInfo.name,
                                deviceType: deviceInfo.type
                            });
                        } catch (error) {
                            console.error('[auth] Failed to capture device info:', error);
                        }
                    }

                    console.log('Authorization successful. Returning user data:', {
                        id: userResponse.id,
                        email: userResponse.email,
                        username: userResponse.username,
                        userType: userResponse.user_type,
                        tenant: userResponse.tenant,
                        hasDeviceInfo: !!userResponse.deviceInfo
                    });
                    console.log('==== Credentials OAuth Authorization Complete ====');
                    return userResponse;
                } catch (error) {
                    console.log('==== Authorization Error ====');
                    console.error('Error details:', {
                        email: credentials?.email
                    });
                    logger.warn("Error authorizing email", credentials?.email, error);
                    throw error;
                }
            }
        }),
        ...(process.env.KEYCLOAK_CLIENT_ID &&
        process.env.KEYCLOAK_CLIENT_SECRET &&
        process.env.KEYCLOAK_URL &&
        process.env.KEYCLOAK_REALM
            ? [
                KeycloakProvider({
                    clientId: process.env.KEYCLOAK_CLIENT_ID as string,
                    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET as string,
                    issuer: `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}`,
                    profile: async (profile): Promise<ExtendedUser> => {
                        return {
                            id: (profile as any).sub || (profile as any).email,
                            name: (profile as any).name || (profile as any).preferred_username,
                            email: (profile as any).email,
                            image: (profile as any).picture,
                            username: (profile as any).preferred_username || '',
                            proToken: '',
                            tenant: (profile as any).tenant,
                            user_type: (profile as any).user_type ?? 'internal',
                            clientId: (profile as any).clientId,
                        };
                    },
                }),
            ]
            : []),
        // CredentialsProvider({
        //     id: "keycloak-credentials",
        //     name: "Keycloak-credentials",
        //     credentials: {
        //         email: { label: "Email", type: "email" },
        //         password: { label: "Password", type: "password" },
        //         twoFactorCode: { label: "2FA Code", type: "text" },
        //     },
        //     async authorize(credentials): Promise<ExtendedUser | null> {
        //         logger.info("Starting Keycloak Credentials OAuth")
        //         if (!credentials?.email || !credentials.password) {
        //             throw new Error("Missing username or password");
        //         }
        //         const user = await User.findUserByEmail(credentials.email);
        //         if (!user || !user.user_id) {
        //             logger.warn("User not found with email", credentials.email);
        //             throw new Error("User not found");
        //         }
        //         if (!user) { return null; }
        //         if (user.two_factor_enabled) {
        //             if (!credentials.twoFactorCode) {
        //                 logger.warn("2FA code required for email", credentials.email);
        //                 return null;
        //             }
        //             if (!user.two_factor_secret) {
        //                 logger.warn("2FA secret not found for email", credentials.email);
        //                 return null;
        //             }
        //             const isValid2FA = await verifyAuthenticator(credentials.twoFactorCode, user.two_factor_secret);
        //             if (!isValid2FA) {
        //                 logger.warn("Invalid 2FA code for email", credentials.email);
        //                 return null;
        //             }
        //         }

        //         try {
        //             // Get token from Keycloak
        //             const tokenData = await getKeycloakToken(user.username, credentials.password);
        //             logger.info("Token Data:", tokenData);
        //             if (!tokenData || !tokenData.access_token) {
        //                 return null;
        //             }
        //             const tokenInfo = decodeToken(tokenData.access_token);
        //             if (!tokenInfo) {
        //                 return null;
        //             }

        //             if (tokenInfo.email !== credentials.email) {
        //                 return null;
        //             }
        //             return {
        //                 id: user.user_id.toString(),
        //                 email: user.email,
        //                 username: user.username,
        //                 image: user.image || '/image/avatar-purple-big.png',
        //                 name: `${user.first_name} ${user.last_name}`,
        //                 proToken: tokenData.access_token,
        //                 tenant: user.tenant,
        //                 user_type: user.user_type
        //             };
        //         } catch (error) {
        //             logger.error("Failed to authenticate with Keycloak:", error);
        //             return null;
        //         }
        //     },
        // }),
    ],
    pages: {
        signIn: '/auth/signin', // This will redirect to the appropriate page
        signOut: '/auth/signin', // After sign out, go to the redirect page
    },
    session: {
        strategy: "jwt",
        maxAge: SESSION_MAX_AGE,
    },
    cookies: {
        sessionToken: SESSION_COOKIE,
    },
    callbacks: {
        async signIn({ user, account, credentials }) {
            // Track successful login
            // const extendedUser = user as ExtendedUser;
            // const { analytics } = await import('server/src/lib/analytics/posthog');
            // analytics.capture(AnalyticsEvents.USER_LOGGED_IN, {
            //     provider: account?.provider || 'credentials',
            //     user_type: extendedUser.user_type,
            //     has_two_factor: false, // We'd need to check this from the user object
            //     login_method: account?.provider || 'email',
            // }, extendedUser.id);
            const providerId = account?.provider;
            const extendedUser = user as ExtendedUser | undefined;

            if (extendedUser && providerId && providerId !== 'credentials') {
                try {
                    const enrichedUser = await applyOAuthAccountHints(
                        toOAuthProfileMappingResult(extendedUser),
                        account as unknown as Record<string, unknown>,
                    );
                    Object.assign(extendedUser, enrichedUser);
                } catch (error) {
                    console.warn('[signIn] failed to apply OAuth tenant hints', {
                        providerId,
                        error,
                    });
                }
            }

            // Track last login
            if (extendedUser?.id && extendedUser?.tenant && providerId) {
                try {
                    const User = (await import('server/src/lib/models/user')).default;
                    await User.updateLastLogin(
                        extendedUser.id,
                        extendedUser.tenant,
                        providerId
                    );
                } catch (error) {
                    console.warn('[signIn] failed to update last login', error);
                }
            }

            if (extendedUser && providerId && providerId !== 'credentials') {
                const accountRecord = account as unknown as Record<string, unknown> | null;
                try {
                    const enrichedUser = await applyOAuthAccountHints(
                        toOAuthProfileMappingResult(extendedUser),
                        accountRecord,
                    );
                    Object.assign(extendedUser, enrichedUser);
                } catch (error) {
                    console.warn('[signIn] failed to apply OAuth tenant hints', {
                        providerId,
                        error,
                    });
                }

                await ensureOAuthAccountLink(extendedUser, accountRecord, providerId);
            }

            if (providerId === 'credentials') {
                const callbackUrl = typeof credentials?.callbackUrl === 'string' ? credentials.callbackUrl : undefined;
                const canonicalBaseUrl = process.env.NEXTAUTH_URL;

                if (extendedUser?.user_type === 'client' && callbackUrl && canonicalBaseUrl) {
                    try {
                        console.log('[signIn] computing vanity redirect');
                        const vanityRedirect = await computeVanityRedirect({
                            url: callbackUrl,
                            baseUrl: canonicalBaseUrl,
                            token: {
                                id: extendedUser.id,
                                email: extendedUser.email,
                                name: extendedUser.name,
                                tenant: extendedUser.tenant,
                                tenantSlug: extendedUser.tenantSlug,
                                user_type: extendedUser.user_type,
                                clientId: extendedUser.clientId,
                                contactId: extendedUser.contactId,
                            },
                        });

                        if (vanityRedirect) {
                            return vanityRedirect;
                        }
                    } catch (error) {
                        console.warn('[signIn] failed to compute client portal redirect', {
                            email: extendedUser?.email,
                            tenant: extendedUser?.tenant,
                            callbackUrl,
                            error,
                        });
                    }
                }
            }

            return true; // Allow sign in
        },
        async jwt({ token, user }) {
            console.log('JWT callback - initial token:', {
                id: token.id,
                email: token.email,
                clientId: token.clientId,
                hasUser: !!user
            });

            if (user) {
                const extendedUser = user as ExtendedUser;
                console.log('JWT callback - new user login:', {
                    id: extendedUser.id,
                    email: extendedUser.email,
                    tenant: extendedUser.tenant,
                    clientId: extendedUser.clientId
                });
                if (!extendedUser.tenantSlug && extendedUser.tenant) {
                    extendedUser.tenantSlug = buildTenantPortalSlug(extendedUser.tenant);
                }
                token.id = extendedUser.id;
                token.email = extendedUser.email;
                token.name = extendedUser.name;
                token.username = extendedUser.username;
                token.image = extendedUser.image;
                token.proToken = extendedUser.proToken;
                token.tenant = extendedUser.tenant;
                token.tenantSlug = extendedUser.tenantSlug;
                token.user_type = extendedUser.user_type;
                token.clientId = extendedUser.clientId;
                token.contactId = extendedUser.contactId;
              }

            // NEW: Create session record on initial sign-in
            // CRITICAL: Only create if session_id doesn't exist (prevents duplicates on OTT redemption)
            if ((user as any)?.deviceInfo && !token.session_id) {
                try {
                    const extendedUser = user as any; // ExtendedUser with deviceInfo and loginMethod added in signIn callback
                    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000);

                    // Determine login method - use captured provider from signIn, or default to credentials
                    const loginMethod = extendedUser.loginMethod || (token.login_method as string | undefined) || 'credentials';

                    const sessionId = await UserSession.create({
                        tenant: token.tenant as string,
                        user_id: token.id as string,
                        ip_address: extendedUser.deviceInfo.ip,
                        user_agent: extendedUser.deviceInfo.userAgent,
                        device_fingerprint: extendedUser.deviceInfo.deviceFingerprint,
                        device_name: extendedUser.deviceInfo.deviceName,
                        device_type: extendedUser.deviceInfo.deviceType,
                        location_data: extendedUser.deviceInfo.locationData,
                        expires_at: expiresAt,
                        login_method: loginMethod,
                    });

                    token.session_id = sessionId;
                    token.login_method = loginMethod;

                    // Fire-and-forget: Update location data asynchronously
                    const ipForLocation = extendedUser.deviceInfo.ip;
                    const tenantForLocation = token.tenant as string;
                    getLocationFromIp(ipForLocation)
                        .then((locationData) => {
                            if (locationData) {
                                return UserSession.updateLocation(tenantForLocation, sessionId, locationData);
                            }
                        })
                        .catch((error) => {
                            console.warn('[auth] Failed to update session location:', error);
                        });

                    // Clean up device info (don't store in token)
                    delete (user as any).deviceInfo;
                } catch (error) {
                    console.error('[auth] Failed to create session record:', error);
                }
            }

            // NEW: Check if session was revoked (throttled to reduce DB load)
            // PERFORMANCE FIX: Only check revocation every 30 seconds, with in-memory cache
            // REMOVED updateActivity() - it was called every 60s per user, exhausting connection pool
            // Activity tracking is not critical and can be updated less frequently via background job
            if (token.session_id) {
                try {
                    const lastRevocationCheck = token.last_revocation_check as number || 0;
                    const now = Date.now();
                    const shouldCheckRevocation = now - lastRevocationCheck > 30000; // 30 seconds

                    if (shouldCheckRevocation) {
                        const isRevoked = await UserSession.isRevoked(
                            token.tenant as string,
                            token.session_id as string
                        );

                        if (isRevoked) {
                            console.log('[auth] Session revoked, forcing logout:', token.session_id);
                            return null; // This will force a logout
                        }

                        token.last_revocation_check = now;
                    }
                } catch (error) {
                    console.error('[auth] Session revocation check error:', error);
                    // Don't block on session check errors
                }
            }

            // PERFORMANCE FIX: Removed validateUser() which was causing connection pool exhaustion
            // - validateUser() called getAdminConnection() on EVERY request (250+ times in logs)
            // - With max 20 connections, pool exhausted instantly with multiple users
            // - Result: "remaining connection slots reserved for superuser" errors
            //
            // Security is maintained by:
            // 1. NextAuth JWT signature validation (cryptographically secure)
            // 2. Session revocation check above (handles compromised sessions)
            // 3. User validation at login time (sufficient for most use cases)
            //
            // If user is deleted/deactivated between requests, they'll be caught at next login

            const result = {
                ...token
                // Token already contains all necessary user data from initial sign-in
                // No need to fetch from DB on every request
            };

            console.log('JWT callback - final token:', {
                id: result.id,
                email: result.email,
                tenant: result.tenant,
                clientId: result.clientId
            });

            return result;
        },
        async session({ session, token }) {
            if (token.error === "TokenValidationError") {
                // If there was an error during token validation, return a special session
                return { expires: "0" };
            }

            const logger = (await import('@alga-psa/shared/core/logger')).default;
            logger.debug("Session Token:", token);
            console.log('Session callback - token:', {
                id: token.id,
                email: token.email,
                tenant: token.tenant,
                tenantSlug: token.tenantSlug,
                user_type: token.user_type,
                clientId: token.clientId,
                contactId: token.contactId
            });

            if (token && session.user) {
                const user = session.user as ExtendedUser;
                // CRITICAL: Ensure id is always set
                if (!token.id) {
                    logger.error('Token missing id field!', { token });
                    console.error('CRITICAL: Token missing id field!', token);
                }
                user.id = token.id as string || token.sub as string || ''; // Fallback to sub if id is missing
                user.email = token.email || '';
                user.name = token.name || '';
                user.username = token.username as string;
                user.image = token.image as string;
                user.proToken = token.proToken as string;
                user.tenant = token.tenant as string;
                user.tenantSlug = token.tenantSlug as string | undefined;
                user.user_type = token.user_type as string;
                user.clientId = token.clientId as string;
                user.contactId = token.contactId as string;
            }
            logger.trace("Session Object:", session);
            console.log('Session callback - final session.user:', {
                id: session.user?.id,
                email: session.user?.email,
                tenant: session.user?.tenant,
                clientId: session.user?.clientId
            });

            // NEW: Add session_id to session object
            if (token.session_id) {
                (session as any).session_id = token.session_id as string;
            }
            if (token.login_method) {
                (session as any).login_method = token.login_method as string;
            }

            return session;
        },
        async redirect({ url, baseUrl }) {
            if (url.includes('/auth/client-portal/handoff')) {
                return url;
            }

            console.log('[redirect] in callbacks');
            const vanityUrl = await computeVanityRedirect({ url, baseUrl, token: null });
            return vanityUrl ?? url;
        },
    },
};

async function validateUser(token: any) {
    try {
        // Fetch the user from the database using email and user_type (lowercase for consistency)
        const User = (await import('server/src/lib/models/user')).default;
        const logger = (await import('@alga-psa/shared/core/logger')).default;
        const user = await User.findUserByEmailAndType(
          token.email.toLowerCase(),
          (token.user_type === 'client' || token.user_type === 'internal') ? token.user_type : 'internal'
        );

        // Check if the user exists and matches
        if (!user) {
            logger.warn(`User not found for email: ${token.email}`);
            return null;
        }

        // Log validation details for debugging
        if (user.user_id !== token.id || user.username !== token.username) {
            logger.warn(`User validation mismatch for email: ${token.email}`, {
                db_user_id: user.user_id,
                token_user_id: token.id,
                db_username: user.username,
                token_username: token.username,
                email: token.email
            });
            // Don't fail validation for ID/username mismatch - user might have been updated
            // The email and user_type are the primary identifiers
        }

        // Check if user is inactive
        if (user.is_inactive) {
            logger.warn(`User is inactive: ${token.email}`);
            return null;
        }

        // Verify tenant matches
        if (user.tenant !== token.tenant) {
            logger.warn(`Tenant mismatch for email: ${token.email}`);
            return null;
        }

        // user_type already matched via lookup

        return user;
    } catch (error) {
        const logger = (await import('@alga-psa/shared/core/logger')).default;
        logger.error("Error validating user:", error);
        return null;
    }
}
