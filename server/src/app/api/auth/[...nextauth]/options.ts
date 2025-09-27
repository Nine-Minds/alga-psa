import CredentialsProvider from "next-auth/providers/credentials";
import KeycloakProvider from "next-auth/providers/keycloak";
import GoogleProvider from "next-auth/providers/google";
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
            companyId: typeof token.companyId === 'string' ? token.companyId : undefined,
            contactId: typeof token.contactId === 'string' ? token.contactId : undefined,
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
    user_type: string;
    companyId?: string;
    contactId?: string;
}

// Helper function to get OAuth secrets from secret provider with env fallback
async function getOAuthSecrets() {
    const { getSecretProviderInstance } = await import('@alga-psa/shared/core/secretProvider');
    const secretProvider = await getSecretProviderInstance();

    const [googleClientId, googleClientSecret, keycloakClientId, keycloakClientSecret, keycloakUrl, keycloakRealm] = await Promise.all([
        secretProvider.getAppSecret('GOOGLE_OAUTH_CLIENT_ID'),
        secretProvider.getAppSecret('GOOGLE_OAUTH_CLIENT_SECRET'),
        secretProvider.getAppSecret('KEYCLOAK_CLIENT_ID'),
        secretProvider.getAppSecret('KEYCLOAK_CLIENT_SECRET'),
        secretProvider.getAppSecret('KEYCLOAK_URL'),
        secretProvider.getAppSecret('KEYCLOAK_REALM')
    ]);

    return {
        googleClientId: googleClientId || process.env.GOOGLE_OAUTH_CLIENT_ID || '',
        googleClientSecret: googleClientSecret || process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
        keycloakClientId: keycloakClientId || process.env.KEYCLOAK_CLIENT_ID || '',
        keycloakClientSecret: keycloakClientSecret || process.env.KEYCLOAK_CLIENT_SECRET || '',
        keycloakUrl: keycloakUrl || process.env.KEYCLOAK_URL || '',
        keycloakRealm: keycloakRealm || process.env.KEYCLOAK_REALM || ''
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
        GoogleProvider({
            clientId: secrets.googleClientId,
            clientSecret: secrets.googleClientSecret,
            profile: async (profile): Promise<ExtendedUser> => {
                const logger = (await import('@alga-psa/shared/core/logger')).default;
                const User = (await import('server/src/lib/models/user')).default;
                logger.info("Starting Google OAuth")
                const user = await User.findUserByEmail(profile.email);
                if (!user || !user.user_id) {
                    logger.warn("User not found with email", profile.email);
                    throw new Error("User not found");
                }

                // Check if user is inactive
                if (user.is_inactive) {
                    logger.warn(`Inactive user attempted to login via Google: ${profile.email}`);
                    // Track failed Google login due to inactive account
                    // const { analytics } = await import('server/src/lib/analytics/posthog');
                    // analytics.capture('login_failed', {
                    //     reason: 'inactive_account',
                    //     provider: 'google',
                    // });
                    throw new Error("User not found");
                }

                logger.info("User sign in successful with email", profile.email);
                return {
                    id: user.user_id.toString(),
                    email: user.email,
                    name: `${user.first_name} ${user.last_name}`,
                    username: user.username,
                    image: profile.picture,
                    proToken: '',
                    tenant: user.tenant,
                    user_type: user.user_type
                };
            },
        }),
        CredentialsProvider({
            name: "Credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
                twoFactorCode: { label: "2FA Code", type: "text" },
                userType: { label: "User Type", type: "text" },
            },
            async authorize(credentials): Promise<ExtendedUser | null> {
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
                    logger.debug("Authorizing email", credentials?.email);
                    if (!credentials?.email || !credentials.password) {
                        console.log('Authentication failed: Missing credentials');
                        logger.warn("Missing credentials");
                        return null;
                    }

                    console.log('Attempting to authenticate user:', credentials.email);
                    console.log('user type', credentials.userType);
                    console.log('next auth secret', process.env.NEXTAUTH_SECRET);
                    const user = await authenticateUser(credentials.email as string, credentials.password as string, credentials.userType as string);
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

                    // If it's a client user, get the contact and company information
                    let companyId: string | undefined = undefined;
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
                            companyId = contact.company_id || undefined;
                            console.log('Company information found:', { companyId });
                            logger.info(`Found company ${companyId} for contact ${user.contact_id}`);
                        } else {
                            console.log('No company information found for contact');
                            logger.warn(`No contact found for user ${user.email} with contact_id ${user.contact_id}`);
                    }
                    }

                    // 2FA Verification
                    if (user.two_factor_enabled) {
                        console.log('2FA is enabled for user, starting verification');
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

                    logger.info("User sign in successful with email", credentials.email);
                    const userResponse = {
                        id: user.user_id.toString(),
                        email: user.email,
                        username: user.username,
                        image: user.image || '/image/avatar-purple-big.png',
                        name: `${user.first_name} ${user.last_name}`,
                        proToken: '',
                        tenant: user.tenant,
                        user_type: user.user_type,
                        companyId: companyId ?? undefined,
                        contactId: user.contact_id
                    };
                    console.log('Authorization successful. Returning user data:', {
                        id: userResponse.id,
                        email: userResponse.email,
                        username: userResponse.username,
                        userType: userResponse.user_type,
                        tenant: userResponse.tenant
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
        KeycloakProvider({
            clientId: secrets.keycloakClientId,
            clientSecret: secrets.keycloakClientSecret,
            issuer: `${secrets.keycloakUrl}/realms/${secrets.keycloakRealm}`,
            profile: async (profile): Promise<ExtendedUser> => {
                const logger = (await import('@alga-psa/shared/core/logger')).default;
                logger.info("Starting Keycloak OAuth")
                return {
                    id: profile.sub,
                    name: profile.name ?? profile.preferred_username,
                    email: profile.email,
                    image: profile.picture,
                    username: profile.preferred_username,
                    proToken: '',
                    tenant: profile.tenant,
                    user_type: profile.user_type,
                    companyId: profile.companyId
                }
            },
        }),
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
            const providerId = account?.provider;

            if (providerId === 'credentials') {
                const extendedUser = user as ExtendedUser | undefined;
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
                                user_type: extendedUser.user_type,
                                companyId: extendedUser.companyId,
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

            return true; // Allow sign in
        },
        async jwt({ token, user }) {
            console.log('JWT callback - initial token:', {
                id: token.id,
                email: token.email,
                companyId: token.companyId,
                hasUser: !!user
            });

            if (user) {
                const extendedUser = user as ExtendedUser;
                console.log('JWT callback - new user login:', {
                    id: extendedUser.id,
                    email: extendedUser.email,
                    tenant: extendedUser.tenant,
                    companyId: extendedUser.companyId
                });
                token.id = extendedUser.id;
                token.email = extendedUser.email;
                token.name = extendedUser.name;
                token.username = extendedUser.username;
                token.image = extendedUser.image;
                token.proToken = extendedUser.proToken;
                token.tenant = extendedUser.tenant;
                token.user_type = extendedUser.user_type;
                token.companyId = extendedUser.companyId;
                token.contactId = extendedUser.contactId;
              }

            // On subsequent requests, validate the token
            const validatedUser = await validateUser(token);
            if (!validatedUser) {
                console.log('JWT callback - validation failed for token:', token);
                // If validation fails, return a token that will cause the session to be invalid
                return { ...token, error: "TokenValidationError" };
            }

            console.log('JWT callback - validated user:', {
                user_id: validatedUser.user_id,
                email: validatedUser.email,
                tenant: validatedUser.tenant
            });

            // For client users, fetch companyId if missing
            let companyId = token.companyId;
            let contactId = token.contactId || validatedUser.contact_id;

            if (validatedUser.user_type === 'client' && validatedUser.contact_id && !companyId) {
                console.log('JWT callback - fetching companyId for client user');
                const { getAdminConnection } = await import("@shared/db/admin");
                const connection = await getAdminConnection();
                const contact = await connection('contacts')
                    .where({
                        contact_name_id: validatedUser.contact_id,
                        tenant: validatedUser.tenant
                    })
                    .first();

                if (contact) {
                    companyId = contact.company_id;
                    console.log('JWT callback - found companyId:', companyId);
                }
            }

            const result = {
                ...token,
                id: validatedUser.user_id, // Always use the validated user_id
                name: validatedUser.first_name + " " + validatedUser.last_name,
                email: validatedUser.email,
                tenant: validatedUser.tenant,
                user_type: validatedUser.user_type,
                companyId: companyId, // Use fetched or preserved companyId
                contactId: contactId  // Use fetched or preserved contactId
            };

            console.log('JWT callback - final token:', {
                id: result.id,
                email: result.email,
                tenant: result.tenant,
                companyId: result.companyId
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
                user_type: token.user_type,
                companyId: token.companyId,
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
                user.user_type = token.user_type as string;
                user.companyId = token.companyId as string;
                user.contactId = token.contactId as string;
            }
            logger.trace("Session Object:", session);
            console.log('Session callback - final session.user:', {
                id: session.user?.id,
                email: session.user?.email,
                tenant: session.user?.tenant,
                companyId: session.user?.companyId
            });
            return session;
        },
        async redirect({ url, baseUrl }) {
            if (url.includes('/auth/client-portal/handoff')) {
                return url;
            }

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
        GoogleProvider({
            clientId: process.env.GOOGLE_OAUTH_CLIENT_ID as string,
            clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET as string,
            profile: async (profile): Promise<ExtendedUser> => {
                return {
                    id: (profile as any).sub || profile.email,
                    email: profile.email,
                    name: (profile as any).name || '',
                    username: (profile as any).given_name || profile.email?.split('@')[0] || '',
                    image: (profile as any).picture,
                    proToken: '',
                    tenant: '',
                    user_type: 'internal'
                };
            },
        }),
        CredentialsProvider({
            name: "Credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
                twoFactorCode: { label: "2FA Code", type: "text" },
                userType: { label: "User Type", type: "text" },
            },
            async authorize(credentials): Promise<ExtendedUser | null> {
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
                    logger.debug("Authorizing email", credentials?.email);
                    if (!credentials?.email || !credentials.password) {
                        console.log('Authentication failed: Missing credentials');
                        logger.warn("Missing credentials");
                        return null;
                    }

                    console.log('Attempting to authenticate user:', credentials.email);
                    const user = await authenticateUser(credentials.email as string, credentials.password as string, credentials.userType as string);
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

                    // If it's a client user, get the contact and company information
                    let companyId: string | undefined = undefined;
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
                            companyId = contact.company_id || undefined;
                            console.log('Company information found:', { companyId });
                            logger.info(`Found company ${companyId} for contact ${user.contact_id}`);
                        } else {
                            console.log('No company information found for contact');
                            logger.warn(`No contact found for user ${user.email} with contact_id ${user.contact_id}`);
                    }
                    }

                    // 2FA Verification
                    if (user.two_factor_enabled) {
                        console.log('2FA is enabled for user, starting verification');
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

                    logger.info("User sign in successful with email", credentials.email);
                    const userResponse = {
                        id: user.user_id.toString(),
                        email: user.email,
                        username: user.username,
                        image: user.image || '/image/avatar-purple-big.png',
                        name: `${user.first_name} ${user.last_name}`,
                        proToken: '',
                        tenant: user.tenant,
                        user_type: user.user_type,
                        companyId: companyId,
                        contactId: user.contact_id
                    };
                    console.log('Authorization successful. Returning user data:', {
                        id: userResponse.id,
                        email: userResponse.email,
                        username: userResponse.username,
                        userType: userResponse.user_type,
                        tenant: userResponse.tenant
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
                    tenant: '',
                    user_type: 'internal',
                    companyId: (profile as any).companyId
                };
            },
        }),
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

            if (providerId === 'credentials') {
                const extendedUser = user as ExtendedUser | undefined;
                const callbackUrl = typeof credentials?.callbackUrl === 'string' ? credentials.callbackUrl : undefined;
                const canonicalBaseUrl = process.env.NEXTAUTH_URL;

                if (extendedUser?.user_type === 'client' && callbackUrl && canonicalBaseUrl) {
                    try {
                        const vanityRedirect = await computeVanityRedirect({
                            url: callbackUrl,
                            baseUrl: canonicalBaseUrl,
                            token: {
                                id: extendedUser.id,
                                email: extendedUser.email,
                                name: extendedUser.name,
                                tenant: extendedUser.tenant,
                                user_type: extendedUser.user_type,
                                companyId: extendedUser.companyId,
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
                companyId: token.companyId,
                hasUser: !!user
            });

            if (user) {
                const extendedUser = user as ExtendedUser;
                console.log('JWT callback - new user login:', {
                    id: extendedUser.id,
                    email: extendedUser.email,
                    tenant: extendedUser.tenant,
                    companyId: extendedUser.companyId
                });
                token.id = extendedUser.id;
                token.email = extendedUser.email;
                token.name = extendedUser.name;
                token.username = extendedUser.username;
                token.image = extendedUser.image;
                token.proToken = extendedUser.proToken;
                token.tenant = extendedUser.tenant;
                token.user_type = extendedUser.user_type;
                token.companyId = extendedUser.companyId;
                token.contactId = extendedUser.contactId;
              }

            // On subsequent requests, validate the token
            const validatedUser = await validateUser(token);
            if (!validatedUser) {
                console.log('JWT callback - validation failed for token:', token);
                // If validation fails, return a token that will cause the session to be invalid
                return { ...token, error: "TokenValidationError" };
            }

            console.log('JWT callback - validated user:', {
                user_id: validatedUser.user_id,
                email: validatedUser.email,
                tenant: validatedUser.tenant
            });

            // For client users, fetch companyId if missing
            let companyId = token.companyId;
            let contactId = token.contactId || validatedUser.contact_id;

            if (validatedUser.user_type === 'client' && validatedUser.contact_id && !companyId) {
                console.log('JWT callback - fetching companyId for client user');
                const { getAdminConnection } = await import("@shared/db/admin");
                const connection = await getAdminConnection();
                const contact = await connection('contacts')
                    .where({
                        contact_name_id: validatedUser.contact_id,
                        tenant: validatedUser.tenant
                    })
                    .first();

                if (contact) {
                    companyId = contact.company_id;
                    console.log('JWT callback - found companyId:', companyId);
                }
            }

            const result = {
                ...token,
                id: validatedUser.user_id, // Always use the validated user_id
                name: validatedUser.first_name + " " + validatedUser.last_name,
                email: validatedUser.email,
                tenant: validatedUser.tenant,
                user_type: validatedUser.user_type,
                companyId: companyId, // Use fetched or preserved companyId
                contactId: contactId  // Use fetched or preserved contactId
            };

            console.log('JWT callback - final token:', {
                id: result.id,
                email: result.email,
                tenant: result.tenant,
                companyId: result.companyId
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
                user_type: token.user_type,
                companyId: token.companyId,
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
                user.user_type = token.user_type as string;
                user.companyId = token.companyId as string;
                user.contactId = token.contactId as string;
            }
            logger.trace("Session Object:", session);
            console.log('Session callback - final session.user:', {
                id: session.user?.id,
                email: session.user?.email,
                tenant: session.user?.tenant,
                companyId: session.user?.companyId
            });
            return session;
        },
        async redirect({ url, baseUrl }) {
            if (url.includes('/auth/client-portal/handoff')) {
                return url;
            }

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
