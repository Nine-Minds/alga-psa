"use server";
import User from "server/src/lib/models/user";

import { verifyPassword } from 'server/src/utils/encryption/encryption';
import logger from "server/src/utils/logger";

import { IUser } from 'server/src/interfaces/auth.interfaces';


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
    const isValid = await verifyPassword(password, user.hashed_password);
    if (!isValid) {
        logger.warn(`Invalid password for email ${email}`);
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