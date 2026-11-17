import { resolveProductCode, type ProductCode } from "@alga-psa/types";
import { buildTenantPortalSlug } from "@alga-psa/validation";
import { getLicenseStateRow, resolveSelfHostTier } from "@alga-psa/licensing";
import { tenantDb } from "@alga-psa/db";
import { UserSession } from "@alga-psa/db/models/UserSession";
import { getSessionMaxAge } from "./session";
import { getLocationFromIp } from "./geolocation";

/**
 * The one place a session token is minted for a signed-in user (alga-2026-0002996).
 *
 * Both the NextAuth `jwt` callback (direct sign-in) and the custom-domain handoff exchange
 * build the token here, so a session reached through a handoff carries exactly the claims a
 * direct sign-in would: identity, tenant, user type, plan/subscription claims, tier, the
 * tracked session id and the login method. Add a claim here and every path gets it.
 */

/**
 * Effective tier override for self-host installs. Returns the tier resolved from
 * the offline `license_state` row (essentials/pro) when present, or
 * undefined in SaaS mode so the session falls back to the Stripe plan. Non-fatal
 * on any error (e.g. an un-migrated `license_state`) — returns undefined.
 */
export async function resolveSelfHostEffectiveTier(): Promise<string | undefined> {
    try {
        const selfHost = resolveSelfHostTier(await getLicenseStateRow());
        if (selfHost !== null) return selfHost.tier;
    } catch {
        // Non-fatal — fall through to plan-based resolution.
    }
    return undefined;
}

/**
 * Fetches the tenant's plan and subscription claims from the database.
 * Used for sign-in minting and the throttled refresh in the JWT callback.
 */
export interface TenantSubscriptionInfo {
    plan?: string;
    product_code?: ProductCode;
    addons?: string[];
    trial_end?: string | null;
    subscription_status?: string | null;
    solo_pro_trial_end?: string | null;
}

export async function fetchTenantSubscriptionInfo(tenantId: string): Promise<TenantSubscriptionInfo> {
    const { getAdminConnection } = await import('@alga-psa/db/admin');
    const knex = await getAdminConnection();

    // Fetch plan from tenants table
    const tenantRecord = await tenantDb(knex, tenantId).table('tenants')
        .select('plan', 'product_code')
        .first();

    // Fetch active subscription status + trial info from stripe_subscriptions
    // Use a single query to minimize DB load (this runs on every JWT refresh)
    let trialEnd: string | null = null;
    let subscriptionStatus: string | null = null;
    let soloProTrialEnd: string | null = null;
    let addOns: string[] = [];

    try {
        const subscription = await tenantDb(knex, tenantId).table('stripe_subscriptions')
            .whereIn('status', ['active', 'trialing', 'past_due', 'unpaid'])
            .orderByRaw("CASE WHEN status = 'trialing' THEN 0 WHEN status = 'active' THEN 1 ELSE 2 END")
            .select('status', 'current_period_end', 'metadata')
            .first();

        if (subscription) {
            subscriptionStatus = subscription.status;

            // For trialing subscriptions, current_period_end is the trial end date
            if (subscription.status === 'trialing' && subscription.current_period_end) {
                trialEnd = new Date(subscription.current_period_end).toISOString();
            }

            const metadata = subscription.metadata || {};
            const activeSoloProTrialEnd = metadata.solo_pro_trial === 'true' && metadata.solo_pro_trial_end
                ? new Date(metadata.solo_pro_trial_end)
                : null;
            if (activeSoloProTrialEnd && activeSoloProTrialEnd.getTime() > Date.now()) {
                soloProTrialEnd = activeSoloProTrialEnd.toISOString();
            }
        }
    } catch {
        // stripe_subscriptions table may not exist in CE or early setup — ignore
    }

    try {
        const addOnRows = await tenantDb(knex, tenantId).table('tenant_addons')
            .select('addon_key', 'expires_at');

        addOns = addOnRows
            .filter((row: { addon_key: string; expires_at: string | Date | null }) => {
                if (!row.expires_at) {
                    return true;
                }

                return new Date(row.expires_at).getTime() > Date.now();
            })
            .map((row: { addon_key: string }) => row.addon_key);
    } catch {
        // tenant_addons may not exist in CE or early setup — ignore
    }

    return {
        plan: tenantRecord?.plan ?? undefined,
        // Unknown or unrecognised values resolve to psa (the same rule as every
        // other product-code read), so the session can only ever carry a known product.
        product_code: resolveProductCode(tenantRecord?.product_code).productCode,
        addons: addOns,
        trial_end: trialEnd,
        subscription_status: subscriptionStatus,
        solo_pro_trial_end: soloProTrialEnd,
    };
}



/** The user a session is minted for: the shape every sign-in path (credentials, OAuth) resolves to. */
export interface SessionUser {
    id: string;
    email?: string | null;
    name?: string | null;
    username?: string | null;
    image?: string | null;
    proToken?: string | null;
    tenant?: string;
    tenantSlug?: string;
    user_type: string;
    clientId?: string;
    contactId?: string;
    deviceInfo?: SessionDeviceInfo;
    loginMethod?: string;
}

export interface SessionDeviceInfo {
    ip: string;
    userAgent: string;
    deviceFingerprint: string;
    deviceName: string;
    deviceType: string;
    locationData: any;
}

const UNKNOWN_DEVICE: SessionDeviceInfo = {
    ip: 'unknown',
    userAgent: 'unknown',
    deviceFingerprint: 'unknown',
    deviceName: 'Unknown device',
    deviceType: 'unknown',
    locationData: null,
};

/** Writes the plan/subscription/tier claims onto a token. Throws if the lookup fails. */
export async function applySubscriptionClaims(token: Record<string, any>, tenant: string, now: number = Date.now()): Promise<void> {
    const subInfo = await fetchTenantSubscriptionInfo(tenant);
    token.plan = subInfo.plan;
    token.product_code = subInfo.product_code;
    token.addons = subInfo.addons;
    token.trial_end = subInfo.trial_end;
    token.subscription_status = subInfo.subscription_status;
    token.solo_pro_trial_end = subInfo.solo_pro_trial_end;
    token.effectiveTier = await resolveSelfHostEffectiveTier();
    token.last_plan_check = now;
}

export interface MintSessionTokenParams {
    /** Token being built; mutated and returned (NextAuth hands the jwt callback its own token). */
    token: Record<string, any>;
    user: SessionUser;
    /** Reuse an existing tracked session instead of creating a record. */
    sessionId?: string;
    /** Overrides `user.loginMethod` (the handoff carries the method the user signed in with). */
    loginMethod?: string;
}

/**
 * Builds the session token claims for a freshly signed-in user and creates the tracked
 * session record. Failures of the plan lookup or the session record are logged and
 * non-fatal here, as on a direct sign-in: the consumer's fail-closed session check then
 * rejects a token that has no tracked session.
 */
export async function mintSessionToken(params: MintSessionTokenParams): Promise<Record<string, any>> {
    const { token, user } = params;

    if (!user.tenantSlug && user.tenant) {
        user.tenantSlug = buildTenantPortalSlug(user.tenant);
    }
    token.id = user.id;
    // Keep `sub` aligned with `id` for middleware/legacy consumers that read `token.sub`.
    token.sub = user.id;
    token.email = user.email;
    token.name = user.name;
    token.username = user.username;
    token.image = user.image;
    token.proToken = user.proToken;
    token.tenant = user.tenant;
    token.tenantSlug = user.tenantSlug;
    token.user_type = user.user_type;
    token.clientId = user.clientId;
    token.contactId = user.contactId;
    // When this token was minted by a sign-in; with `login_method` it lets the
    // tenant login policy tell password sessions issued before a cutoff.
    token.auth_issued_at = Date.now();

    if (user.tenant) {
        try {
            await applySubscriptionClaims(token, user.tenant);
        } catch (error) {
            console.error('[auth] Failed to fetch tenant subscription info:', error);
        }
    }

    const loginMethod = params.loginMethod || user.loginMethod || (token.login_method as string | undefined) || 'credentials';

    if (params.sessionId) {
        token.session_id = params.sessionId;
        token.login_method = loginMethod;
    }

    // Only create a session record when none exists yet (prevents duplicates on OTT redemption).
    if (!token.session_id) {
        try {
            const deviceInfo = user.deviceInfo ?? UNKNOWN_DEVICE;
            const expiresAt = new Date(Date.now() + getSessionMaxAge() * 1000);

            // sessions.tenant / user_id are NOT NULL FKs: an OAuth profile that never
            // resolved to an AlgaPSA user fails here, and the fail-closed check then
            // reports only "missing identity claims". Name the real gap first.
            if (typeof token.tenant !== 'string' || typeof token.id !== 'string') {
                console.error('[auth] Cannot create session record: OAuth profile did not resolve to an AlgaPSA user', {
                    loginMethod,
                    email: token.email,
                    hasTenant: typeof token.tenant === 'string',
                    hasUserId: typeof token.id === 'string',
                    userType: token.user_type,
                });
            }

            const sessionId = await UserSession.create({
                tenant: token.tenant as string,
                user_id: token.id as string,
                ip_address: deviceInfo.ip,
                user_agent: deviceInfo.userAgent,
                device_fingerprint: deviceInfo.deviceFingerprint,
                device_name: deviceInfo.deviceName,
                device_type: deviceInfo.deviceType,
                location_data: deviceInfo.locationData,
                expires_at: expiresAt,
                login_method: loginMethod,
            });

            token.session_id = sessionId;
            token.login_method = loginMethod;

            // Fire-and-forget: Update location data asynchronously
            const tenantForLocation = token.tenant as string;
            getLocationFromIp(deviceInfo.ip)
                .then((locationData) => {
                    if (locationData) {
                        return UserSession.updateLocation(tenantForLocation, sessionId, locationData);
                    }
                })
                .catch((error) => {
                    console.warn('[auth] Failed to update session location:', error);
                });

            // Device info is not stored in the token.
            if (user.deviceInfo) {
                delete user.deviceInfo;
            }
        } catch (error) {
            console.error('[auth] Failed to create session record:', {
                loginMethod: token.login_method,
                email: token.email,
                tenant: token.tenant,
                userId: token.id,
                error,
            });
        }
    }

    return token;
}

/**
 * Loads a user for minting a session on a handoff, without a sign-in in hand. Returns
 * undefined for an unknown or inactive user. Mirrors the user the credentials `authorize()`
 * resolves (client users carry their contact's client). `proToken` is the empty legacy
 * value `authorize()` uses.
 */
export async function loadSessionUser(tenant: string, userId: string): Promise<SessionUser | undefined> {
    const { getAdminConnection } = await import('@alga-psa/db/admin');
    const knex = await getAdminConnection();
    const row = await tenantDb(knex, tenant).table('users')
        .where({ user_id: userId })
        .first();
    if (!row || row.is_inactive) {
        return undefined;
    }

    let clientId: string | undefined;
    if (row.user_type === 'client' && row.contact_id) {
        const contact = await tenantDb(knex, tenant).table('contacts')
            .where({ contact_name_id: row.contact_id })
            .first();
        clientId = contact?.client_id || undefined;
    }

    return {
        id: String(row.user_id),
        email: row.email,
        username: row.username,
        image: row.icon || '/image/avatar-purple-big.png',
        name: `${row.first_name} ${row.last_name}`,
        proToken: '',
        tenant: row.tenant,
        tenantSlug: buildTenantPortalSlug(row.tenant),
        user_type: row.user_type,
        clientId,
        contactId: row.contact_id ?? undefined,
    };
}
