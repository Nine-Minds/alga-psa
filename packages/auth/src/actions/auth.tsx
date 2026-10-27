"use server";
import User from "@alga-psa/db/models/user";
import { getTenantIdBySlug } from "@alga-psa/db";

import { verifyPassword } from '@alga-psa/core/encryption';
import logger from "@alga-psa/core/logger";

import { IUser, isInteractiveUserType } from '@alga-psa/types';
import { isValidTenantSlug } from '@alga-psa/validation';
import { isEnterprise } from '@alga-psa/core/features';
import { loadEnterpriseInactiveLoginWinbackHook } from '../lib/winback/enterpriseWinbackEntry';
import { normalizeLoginEmail } from '../lib/security/loginEmail';
interface AuthenticateUserOptions {
    tenantId?: string;
    tenantSlug?: string;
    /** Vanity client-portal host the attempt arrived on, when no slug came with it. */
    portalDomain?: string;
    requireTenantMatch?: boolean;
}

async function triggerInactiveLoginWinback(user: IUser): Promise<void> {
    if (!isEnterprise || !user.tenant) {
        return;
    }

    const hook = await loadEnterpriseInactiveLoginWinbackHook();
    if (!hook) {
        return;
    }

    await hook({ tenantId: user.tenant });
}

/** Tenant that owns an active portal domain, or null. */
async function resolveTenantFromPortalDomain(portalDomain: string): Promise<string | null> {
    const normalized = portalDomain.trim().toLowerCase();
    if (!normalized) {
        return null;
    }

    try {
        const { getAdminConnection } = await import('@alga-psa/db/admin');
        const { getPortalDomainByHostname } = await import('../lib/PortalDomainModel');
        const knex = await getAdminConnection();

        const candidates = normalized.includes(':')
            ? [normalized, normalized.replace(/:\d+$/, '')]
            : [normalized];

        for (const candidate of candidates) {
            const record = await getPortalDomainByHostname(knex, candidate);
            if (record?.status === 'active') {
                return record.tenant;
            }
        }

        logger.warn('[authenticateUser] No active portal domain for host', { portalDomain: normalized });
        return null;
    } catch (error) {
        logger.warn('[authenticateUser] Failed to resolve tenant from portal domain', {
            portalDomain: normalized,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
        return null;
    }
}

/**
 * Oldest account first, then user_id: a total order on immutable columns, so
 * the same duplicates always resolve to the same user.
 */
function compareByCreationThenId(a: IUser, b: IUser): number {
    const aCreated = a.created_at ? new Date(a.created_at).getTime() : Number.POSITIVE_INFINITY;
    const bCreated = b.created_at ? new Date(b.created_at).getTime() : Number.POSITIVE_INFINITY;
    if (aCreated !== bCreated) {
        return aCreated < bCreated ? -1 : 1;
    }
    return a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0;
}

type UnscopedResolution = {
    user: IUser | undefined;
    /** True when `user`'s password was already checked against this attempt. */
    passwordVerified: boolean;
};

/**
 * Sign-in with no tenant in hand. A `.first()` lookup answers an arbitrary
 * tenant and can select an inactive restored account instead of the live
 * workspace. Look at every match instead, and when the credentials prove out
 * in more than one tenant, refuse instead of choosing a workspace. Only an attempt
 * that already knows the password learns that the email spans tenants.
 * Duplicates inside one tenant resolve by `compareByCreationThenId`.
 */
async function resolveUnscopedUser(
    normalizedEmail: string,
    password: string,
    userType: 'client' | 'internal',
): Promise<UnscopedResolution> {
    const candidates = await User.findUsersByEmailAndType(normalizedEmail, userType);

    if (candidates.length <= 1) {
        return { user: candidates[0], passwordVerified: false };
    }

    const authenticated: IUser[] = [];
    for (const candidate of candidates) {
        if (candidate.is_inactive || !candidate.hashed_password) {
            continue;
        }
        if (await verifyPassword(password, candidate.hashed_password)) {
            authenticated.push(candidate);
        }
    }

    const tenants = new Set(authenticated.map((candidate) => candidate.tenant));
    if (tenants.size > 1) {
        logger.warn('[authenticateUser] Credentials resolve to users in multiple tenants', {
            email: normalizedEmail,
            userType,
            tenantCount: tenants.size,
        });
        const { TenantRequiredError } = await import('../lib/security/loginProtection');
        throw new TenantRequiredError();
    }

    authenticated.sort(compareByCreationThenId);
    return { user: authenticated[0], passwordVerified: authenticated.length > 0 };
}

export async function authenticateUser(
    email: string,
    password: string,
    userType?: string,
    options: AuthenticateUserOptions = {}
): Promise<IUser | null> {
    logger.info('[authenticateUser] Attempting authentication', {
        email,
        userType,
        hasTenantId: Boolean(options.tenantId),
        hasTenantSlug: Boolean(options.tenantSlug),
        hasPortalDomain: Boolean(options.portalDomain),
    });

    const normalizedEmail = normalizeLoginEmail(email);
    if (!normalizedEmail || !password) {
        logger.warn("[authenticateUser] Missing credentials");
        return null;
    }

    let resolvedTenantId: string | undefined | null = options.tenantId;

    if (!resolvedTenantId && options.tenantSlug) {
        if (!isValidTenantSlug(options.tenantSlug)) {
            logger.warn('[authenticateUser] Invalid tenant slug provided', {
                email,
                tenantSlug: options.tenantSlug,
            });
            return null;
        }

        resolvedTenantId = await getTenantIdBySlug(options.tenantSlug);
        if (!resolvedTenantId) {
            logger.warn('[authenticateUser] Failed to resolve tenant from slug', {
                email,
                tenantSlug: options.tenantSlug,
            });
            return null;
        }
    }

    // A vanity client-portal host identifies its tenant just as well as a slug,
    // and is all the handoff round-trip carries.
    let tenantFromPortalDomain = false;
    if (!resolvedTenantId && options.portalDomain && userType === 'client') {
        resolvedTenantId = await resolveTenantFromPortalDomain(options.portalDomain);
        tenantFromPortalDomain = Boolean(resolvedTenantId);
    }

    // Only interactive types may authenticate with a password, and the caller must say
    // which one: there is no untyped lookup, so a POST that omits userType is refused.
    if (!isInteractiveUserType(userType)) {
        logger.warn('[authenticateUser] Missing or non-interactive userType rejected', { email, userType });
        return null;
    }

    let user: IUser | undefined;
    let passwordVerified = false;
    if (resolvedTenantId) {
        user = await User.findUserByEmailTenantAndType(normalizedEmail, resolvedTenantId, userType);
    } else {
        ({ user, passwordVerified } = await resolveUnscopedUser(normalizedEmail, password, userType));
    }

    if (!user || !user.user_id) {
        logger.warn(`[authenticateUser] No user found with email ${email}`);
        return null;
    }

    if (
        (options.requireTenantMatch || Boolean(options.tenantSlug) || tenantFromPortalDomain) &&
        resolvedTenantId &&
        user.tenant !== resolvedTenantId
    ) {
        logger.warn('[authenticateUser] Tenant mismatch during authentication', {
            email,
            expectedTenant: resolvedTenantId,
            actualTenant: user.tenant,
            tenantSlug: options.tenantSlug,
        });
        return null;
    }

    if (!isInteractiveUserType(user.user_type)) {
        logger.warn('[authenticateUser] Non-interactive user attempted to login', { email });
        return null;
    }

    // Check if user is inactive
    if (user.is_inactive) {
        logger.warn(`[authenticateUser] Inactive user attempted to login: ${email}`);
        void triggerInactiveLoginWinback(user).catch((error) => {
            logger.warn('[authenticateUser] Login win-back hook failed', {
                email,
                tenant: user?.tenant,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        });
        return null;
    }

    if (!user.hashed_password) {
        logger.warn(`[authenticateUser] Missing hashed_password for email ${email}`);
        return null;
    }

    const isValid = passwordVerified || await verifyPassword(password, user.hashed_password);
    if (!isValid) {
        logger.warn(`[authenticateUser] Invalid password for email ${email}`);
        return null;
    }

    return user;
}



export async function have_two_factor_enabled( password: string, email: string, userType: 'internal' | 'client'): Promise<boolean> {
    logger.system(`Checking if user has 2FA enabled for email ${email}`);
    const user = await authenticateUser(email, password, userType);
    if (!user || !user.two_factor_enabled) { return false; }
    return true;
}

export async function userExists( email: string): Promise<boolean> {
    logger.system(`Checking if user exists for email ${email}`);
    const user = await User.findUserByEmail(normalizeLoginEmail(email));
    if (!user || !user.user_id) { return false; }
    return true;
}
