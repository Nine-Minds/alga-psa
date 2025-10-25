"use server";
import User from "server/src/lib/models/user";

import { verifyPassword } from 'server/src/utils/encryption/encryption';
import logger from "server/src/utils/logger";

import { IUser } from 'server/src/interfaces/auth.interfaces';
import { analytics } from '../analytics/posthog';
import { getTenantIdBySlug } from './tenant-actions/tenantSlugActions';
import { isValidTenantSlug } from '../utils/tenantSlug';

interface AuthenticateUserOptions {
    tenantId?: string;
    tenantSlug?: string;
    requireTenantMatch?: boolean;
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
    });

    if (!email || !password) {
        logger.warn("[authenticateUser] Missing credentials");
        return null;
    }

    const normalizedEmail = email.toLowerCase();
    let resolvedTenantId = options.tenantId;

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

    let user: IUser | undefined;
    if (userType === 'client' || userType === 'internal') {
        if (resolvedTenantId) {
            user = await User.findUserByEmailTenantAndType(normalizedEmail, resolvedTenantId, userType);
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
        (options.requireTenantMatch || Boolean(options.tenantSlug)) &&
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
        analytics.capture('login_failed', {
            reason: 'inactive_account',
            has_two_factor: user.two_factor_enabled,
        });
        return null;
    }

    const isValid = await verifyPassword(password, user.hashed_password);
    if (!isValid) {
        logger.warn(`[authenticateUser] Invalid password for email ${email}`);
        analytics.capture('login_failed', {
            reason: 'invalid_password',
            has_two_factor: user.two_factor_enabled,
        });
        return null;
    }

    analytics.capture(
        'auth_validated',
        {
            has_two_factor: user.two_factor_enabled,
            is_admin: (user as any).is_admin || false,
        },
        user.user_id
    );

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
