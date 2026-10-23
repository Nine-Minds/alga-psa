"use server";
import User from "@alga-psa/db/models/user";
import { getTenantIdBySlug } from "@alga-psa/db";

import { verifyPassword } from '@alga-psa/core/encryption';
import logger from "@alga-psa/core/logger";

import { IUser } from '@alga-psa/types';
import { isValidTenantSlug } from '@alga-psa/validation';
import { isEnterprise } from '@alga-psa/core/features';
import { loadEnterpriseInactiveLoginWinbackHook } from '../lib/winback/enterpriseWinbackEntry';
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
 * Client sign-in with no tenant in hand. The old `.first()` lookup answered an
 * arbitrary tenant here, so an email with client users in two portals could be
 * authenticated against — and handed off to — the wrong MSP. Look at every
 * match instead, and when the credentials prove out in more than one tenant,
 * refuse and let the form ask which organization was meant. Only an attempt
 * that already knows the password learns that the email spans tenants.
 */
async function resolveUnscopedClientUser(
    normalizedEmail: string,
    password: string,
): Promise<IUser | undefined> {
    const candidates = await User.findUsersByEmailAndType(normalizedEmail, 'client');

    if (candidates.length <= 1) {
        return candidates[0];
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
        logger.warn('[authenticateUser] Email resolves to client users in multiple tenants', {
            email: normalizedEmail,
            tenantCount: tenants.size,
        });
        const { TenantRequiredError } = await import('../lib/security/loginProtection');
        throw new TenantRequiredError();
    }

    return authenticated[0];
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

    if (!email || !password) {
        logger.warn("[authenticateUser] Missing credentials");
        return null;
    }

    const normalizedEmail = email.toLowerCase();
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

    let user: IUser | undefined;
    if (userType === 'client' || userType === 'internal') {
        if (resolvedTenantId) {
            user = await User.findUserByEmailTenantAndType(normalizedEmail, resolvedTenantId, userType);
        } else if (userType === 'client') {
            user = await resolveUnscopedClientUser(normalizedEmail, password);
        } else {
            user = await User.findUserByEmailAndType(normalizedEmail, userType);
        }
    } else {
        user = await User.findUserByEmail(normalizedEmail);
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

    const isValid = await verifyPassword(password, user.hashed_password);
    if (!isValid) {
        logger.warn(`[authenticateUser] Invalid password for email ${email}`);
        return null;
    }

    return user;
}



export async function have_two_factor_enabled( password: string, email: string): Promise<boolean> {
    logger.system(`Checking if user has 2FA enabled for email ${email}`);
    const user = await authenticateUser(email, password);
    if (!user || !user.two_factor_enabled) { return false; }
    return true;
}

export async function userExists( email: string): Promise<boolean> {
    logger.system(`Checking if user exists for email ${email}`);
    const user = await User.findUserByEmail(email.toLowerCase());
    if (!user || !user.user_id) { return false; }
    return true;
}
