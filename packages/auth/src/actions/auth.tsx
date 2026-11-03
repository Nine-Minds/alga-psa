"use server";
import User from "@alga-psa/db/models/user";
import logger from "@alga-psa/core/logger";
import { sanitizeUserFields, type PublicUser } from '@alga-psa/types';
import { authenticateUserForAuth, type AuthenticateUserOptions } from '../lib/authenticateUserForAuth';
import { normalizeLoginEmail } from '../lib/security/loginEmail';

/** Public action response; credentials remain inside the authentication module. */
export async function authenticateUser(
    email: string,
    password: string,
    userType?: string,
    options: AuthenticateUserOptions = {}
): Promise<PublicUser | null> {
    const user = await authenticateUserForAuth(email, password, userType, options);
    return user ? sanitizeUserFields(user) : null;
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
