"use server";
import { v4 as uuidv4 } from 'uuid';

import User from '@alga-psa/db/models/user';
import Tenant from '@alga-psa/db/models/tenant';
import { getAdminConnection } from '@alga-psa/db/admin';

import { IUserRegister, IUserWithRoles, IRoleWithPermissions } from '@alga-psa/types';

import { getInfoFromToken, createToken } from '../lib/tokenizer';
import { hashPassword } from '@alga-psa/core/encryption';
import logger from '@alga-psa/core/logger';
import { isValidEmail } from '@alga-psa/validation';

import { getAuthEmailRegistry } from '../lib/emailRegistry';
import { buildPasswordResetLink } from '../lib/portalDomain';

const VERIFY_EMAIL_ENABLED = process.env.VERIFY_EMAIL_ENABLED === 'true';
const EMAIL_ENABLE = process.env.EMAIL_ENABLE === 'true';

interface VerifyResponse {
  message: string;
  wasSuccess: boolean;
}

export async function verifyRegisterUser(token: string): Promise<VerifyResponse> {
  logger.system('Verifying user registration');
  const { errorType, userInfo } = await getInfoFromToken(token);
  logger.info(`User info got for email: ${userInfo?.email}`);
  if (userInfo) {
    try {
      const db = await getAdminConnection();
      await Tenant.insert(db, {
        client_name: userInfo.clientName,
        email: userInfo.email.toLowerCase(),
        created_at: new Date(),
        plan: 'pro',
      });
      const superadminRole: IRoleWithPermissions = {
        role_id: 'superadmin',
        role_name: 'superadmin',
        description: 'Superadmin role',
        permissions: [],
        msp: true,
        client: false
      };
      const newUser: Omit<IUserWithRoles, 'tenant'> = {
        user_id: uuidv4(),
        username: userInfo.username.toLowerCase(),
        email: userInfo.email.toLowerCase(),
        hashed_password: userInfo.password,
        created_at: new Date(),
        roles: [superadminRole],
        is_inactive: false,
        user_type: 'internal'
      };
      await User.insert(db, newUser);

      return {
        message: 'User verified and registered successfully',
        wasSuccess: true,
      };
    } catch (error) {
      logger.error('Error verifying and registering user:', error);
      return {
        message: 'Failed to verify and register user',
        wasSuccess: false,
      };
    }
  }
  return {
    message: errorType || 'Invalid token',
    wasSuccess: false,
  };
}

export async function getAccountInfoFromToken(token: string, portal: string) {
  try {
    const { errorType, userInfo } = await getInfoFromToken(token);
    if (errorType || !userInfo) {
      return null;
    }
    
    // Get the user from database to get full name
    let dbUser;
    if (userInfo.user_type) {
      dbUser = await User.findUserByEmailAndType(userInfo.email, userInfo.user_type as 'internal' | 'client');
    } else {
      dbUser = await User.findUserByEmail(userInfo.email);
    }
    
    return {
      name: dbUser ? `${dbUser.first_name || ''} ${dbUser.last_name || ''}`.trim() || dbUser.username : userInfo.username || 'User',
      email: userInfo.email || '',
      username: dbUser?.username || userInfo.username || userInfo.email || '',
      accountType: portal === 'client' ? 'Client Portal User' : 'MSP User'
    };
  } catch (error) {
    logger.error('Error getting account info from token:', error);
    return null;
  }
}

export async function setNewPassword(password: string, token: string): Promise<boolean> {
  const { errorType, userInfo } = await getInfoFromToken(token);
  if (errorType) {
    logger.error(`Error decoding token: ${errorType}`);
    return false;
  }
  if (userInfo && userInfo.email) {
    const hashedPassword = await hashPassword(password);
    
    // If user_type is in the token, use it to find the correct user
    let dbUser;
    if (userInfo.user_type) {
      dbUser = await User.findUserByEmailAndType(userInfo.email, userInfo.user_type as 'internal' | 'client');
    } else {
      // Fallback for old tokens without user_type
      dbUser = await User.findUserByEmail(userInfo.email);
    }
    
    if (!dbUser) {
      logger.error(`User [ ${userInfo.email} ] with type [ ${userInfo.user_type || 'any'} ] not found in the database`);
      return false;
    }
    
    await User.updatePassword(dbUser.user_id, dbUser.tenant, hashedPassword);
    logger.info(`Password updated successfully for User [ ${userInfo.email} ] type [ ${dbUser.user_type} ] id [ ${dbUser.user_id} ]`);
    return true;
  }
  return false;
}

export async function recoverPassword(
  email: string,
  portal: 'msp' | 'client' = 'msp',
  portalDomain?: string
): Promise<boolean> {
  // Normalize the address once; validation, lookup, token payload, recipient,
  // and logging all share this value.
  const normalizedEmail = email.trim().toLowerCase();
  // For MSP portal, look for 'internal' users; for client portal, look for 'client' users
  const userType = portal === 'msp' ? 'internal' : 'client';

  // Invalid format is indistinguishable from an unknown address: finish with
  // the generic success result without a lookup or send attempt.
  if (!isValidEmail(normalizedEmail)) {
    logger.debug('Password recovery skipped: invalid email format', { portal, userType });
    return true;
  }

  logger.debug('Checking if email exists for portal type', { portal, userType });

  let matchedTenant: string | undefined;
  try {
    const userInfo = await User.findUserByEmailAndType(normalizedEmail, userType);

    // Only a matched, active user of the requested portal type may produce a
    // token or send attempt. Unknown and inactive users resolve to the same
    // generic success result and never mint a token or write an email log.
    if (!userInfo || userInfo.is_inactive) {
      logger.debug('Password recovery skipped: no active matching user', { portal, userType });
      return true;
    }
    matchedTenant = userInfo.tenant;

    // Provider readiness is decided by the send path, not by an environment
    // flag here. An enabled tenant SMTP/Resend/Microsoft provider therefore
    // works even when EMAIL_ENABLE is false or unset; the system fallback
    // remains controlled by SystemEmailProviderFactory and EMAIL_ENABLE.
    const recoverToken = await createToken({
      username: '',
      email: normalizedEmail,
      password: '',
      clientName: '',
      user_type: userType  // Include the correct user type in token
    });

    const resetLink = buildPasswordResetLink(
      process.env.NEXT_PUBLIC_BASE_URL,
      recoverToken,
      portal,
      portalDomain
    );

    // Use the proper sendPasswordResetEmail function which respects language hierarchy
    await getAuthEmailRegistry().sendPasswordResetEmail({
      email: normalizedEmail,
      userName: `${userInfo.first_name || ''} ${userInfo.last_name || ''}`.trim() || userInfo.username || normalizedEmail,
      resetLink,
      expirationTime: '1 hour',
      tenant: userInfo.tenant,
      supportEmail: 'support@algapsa.com',
      clientName: 'AlgaPSA'
    });

    logger.info('Password recovery email sent successfully', {
      portal,
      userType,
      tenant: userInfo.tenant,
      email: normalizedEmail
    });
    return true;
  } catch (error) {
    // All lookup, token, and send failures resolve to the same public success
    // value: an unauthenticated requester must never learn whether an account
    // exists or whether delivery succeeded. Operators observe failures through
    // structured application logs and the Email Log. The token and reset URL
    // are never logged.
    logger.error('password_recovery_send_failed', {
      portal,
      userType,
      tenant: matchedTenant,
      error: error instanceof Error ? error.message : String(error)
    });
    return true;
  }
}

export async function registerUser({ username, email, password, clientName }: IUserRegister): Promise<boolean> {
  logger.debug(`Checking if email [ ${email} ] already exists`);
  const existingEmail = await User.findUserByEmail(email);
  if (existingEmail) {
    logger.error(`User [ ${email} ] already exists`);
    return false;
  }

  logger.debug(`Checking if username [ ${username} ] already exists`);
  const db = await getAdminConnection();
  const existingUsername = await User.findUserByUsername(db, username);
  if (existingUsername) {
    logger.error(`User [ ${username} ] already exists`);
    return false;
  }

  const hashedPassword = await hashPassword(password);

  const verificationToken = await createToken({
    username: username,
    email: email,
    password: hashedPassword,
    clientName: clientName,
    user_type: 'client'
  });

  if (VERIFY_EMAIL_ENABLED && EMAIL_ENABLE) {
    const verificationUrl = `${process.env.HOST}/auth/verify-email?token=${verificationToken}`;
    
    // Use SystemEmailService for email verification
    const systemEmailService = await getAuthEmailRegistry().getSystemEmailService();
    const emailResult = await systemEmailService.sendEmailVerification({
      email: email,
      verificationUrl: verificationUrl,
      clientName: clientName,
      expirationTime: '24 hours'
    });

    if (!emailResult.success) {
      logger.error('Failed to send verification email:', emailResult.error);
      return false;
    }
    logger.info(`Verification email sent successfully for User [ ${email} ]`);
    return true;
  } else {
    try {
      const db = await getAdminConnection();
      await Tenant.insert(db, {
        client_name: clientName,
        email: email.toLowerCase(),
        created_at: new Date(),
        plan: 'pro',
      });
      const superadminRole: IRoleWithPermissions = {
        role_id: 'superadmin',
        role_name: 'superadmin',
        description: 'Superadmin role',
        permissions: [],
        msp: true,
        client: false
      };
      const newUser: Omit<IUserWithRoles, 'tenant'> = {        
        user_id: uuidv4(),
        username: username.toLowerCase(),
        email: email.toLowerCase(),
        hashed_password: hashedPassword,
        created_at: new Date(),
        roles: [superadminRole],
        is_inactive: false,
        user_type: 'internal'
      };
      await User.insert(db, newUser);

      logger.info(`User [ ${email} ] registered successfully`);
      return true;
    } catch (error) {
      logger.error(`Failed to register user [ ${email} ]:`, error);
      return false;
    }
  }
}
