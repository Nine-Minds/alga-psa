"use server";
import User from "server/src/lib/models/user";

import { verifyPassword } from 'server/src/utils/encryption/encryption';
import logger from "server/src/utils/logger";

import { IUser } from 'server/src/interfaces/auth.interfaces';
import { withTransaction } from '../../../../shared/db';
import { Knex } from 'knex';
import { analytics } from '../analytics/posthog';
import { AnalyticsEvents } from '../analytics/events';


export async function authenticateUser( email: string, password: string): Promise<IUser | null> {
    if (!email || !password) {
        logger.warn("Missing credentials");
        return null;
    }
    const user = await User.findUserByEmail(email.toLowerCase());
    if (!user || !user.user_id) {
        logger.warn(`No user found with email ${email}`);
        return null;
    }
    
    // Check if user is inactive
    if (user.is_inactive) {
        logger.warn(`Inactive user attempted to login: ${email}`);
        // Track failed login attempt due to inactive account
        analytics.capture('login_failed', {
            reason: 'inactive_account',
            has_two_factor: user.two_factor_enabled,
        });
        return null; // Return null just like wrong password
    }
    
    const isValid = await verifyPassword(password, user.hashed_password);
    if (!isValid) {
        logger.warn(`Invalid password for email ${email}`);
        // Track failed login attempt due to invalid password
        analytics.capture('login_failed', {
            reason: 'invalid_password',
            has_two_factor: user.two_factor_enabled,
        });
        return null;
    }
    
    // Track successful authentication (login success tracked in NextAuth callbacks)
    analytics.capture('auth_validated', {
        has_two_factor: user.two_factor_enabled,
        is_admin: (user as any).is_admin || false,
    }, user.user_id);
    
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