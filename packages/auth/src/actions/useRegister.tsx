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
    
    // Update the password using the updatePassword function which doesn't require tenant context
    await User.updatePassword(userInfo.email, hashedPassword);
    logger.info(`Password updated successfully for User [ ${userInfo.email} ] type [ ${dbUser.user_type} ] id [ ${dbUser.user_id} ]`);
    return true;
  }
  return false;
}

export async function recoverPassword(email: string, portal: 'msp' | 'client' = 'msp'): Promise<boolean> {
  if (!isValidEmail(email)) {
    logger.debug(`Invalid email format: [ ${email} ]`);
    return true; // Return true for security - don't reveal invalid format
  }

  logger.debug(`Checking if email [ ${email} ] exists for portal type: ${portal}`);
  
  // For MSP portal, look for 'internal' users; for client portal, look for 'client' users
  const userType = portal === 'msp' ? 'internal' : 'client';
  const userInfo = await User.findUserByEmailAndType(email, userType);
  
  if (!userInfo) {
    logger.debug(`No ${userType} user found with email [ ${email} ]`);
    // For security, always return true to not reveal if user exists
    // But don't actually send an email since there's no matching user
    return true;
  }

  // Only proceed with email if we found a user of the correct type
  if (EMAIL_ENABLE) {
    // For password reset, we only need the email in the token
    // This makes the token much shorter
    const recoverToken = await createToken({
      username: '',
      email: email,
      password: '',
      clientName: '',
      user_type: userType  // Include the correct user type in token
    });

    const resetLink = `${process.env.NEXT_PUBLIC_BASE_URL}/auth/password-reset/set-new-password?token=${recoverToken}&portal=${portal}`;

    // Use the proper sendPasswordResetEmail function which respects language hierarchy
    try {
      await getAuthEmailRegistry().sendPasswordResetEmail({
        email,
        userName: `${userInfo.first_name || ''} ${userInfo.last_name || ''}`.trim() || userInfo.username || email,
        resetLink,
        expirationTime: '1 hour',
        tenant: userInfo.tenant,
        supportEmail: 'support@algapsa.com',
        clientName: 'AlgaPSA'
      });

      logger.info(`Recover password email sent successfully for User [ ${email} ]`);
      return true;
    } catch (error) {
      logger.error('Failed to send recover password email:', error);
      return false;
    }
  } else {
    logger.error('Password recovery unavailable: Automatic email functionality is not enabled or configured correctly. Please contact system administrator for manual password reset.');
    return false;
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
