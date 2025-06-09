"use server";
import { v4 as uuidv4 } from 'uuid';

import User from 'server/src/lib/models/user';
import Tenant from 'server/src/lib/models/tenant';
import { getAdminConnection } from 'server/src/lib/db/admin';

import { IUserRegister, IUserWithRoles, IRoleWithPermissions } from 'server/src/interfaces/auth.interfaces';

import { getInfoFromToken, createToken } from 'server/src/utils/tokenizer';
import { hashPassword } from 'server/src/utils/encryption/encryption';
import { getEmailService } from 'server/src/services/emailService';
import { EmailProviderManager } from 'server/src/services/email/EmailProviderManager';
import { TenantEmailSettings, EmailMessage } from 'server/src/types/email.types';
import logger from 'server/src/utils/logger';

const VERIFY_EMAIL_ENABLED = process.env.VERIFY_EMAIL_ENABLED === 'true';
const EMAIL_ENABLE = process.env.EMAIL_ENABLE === 'true';

interface VerifyResponse {
  message: string;
  wasSuccess: boolean;
}

export async function verifyRegisterUser(token: string): Promise<VerifyResponse> {
  logger.system('Verifying user registration');
  const { errorType, userInfo } = getInfoFromToken(token);
  logger.info(`User info got for email: ${userInfo?.email}`);
  if (userInfo) {
    try {
      const db = await getAdminConnection();
      await Tenant.insert(db, {
        company_name: userInfo.companyName,
        email: userInfo.email.toLowerCase(),
        created_at: new Date(),
      });
      const superadminRole: IRoleWithPermissions = {
        role_id: 'superadmin',
        role_name: 'superadmin',
        description: 'Superadmin role',
        permissions: []
      };
      const newUser: Omit<IUserWithRoles, 'tenant'> = {
        user_id: uuidv4(),
        username: userInfo.username.toLowerCase(),
        email: userInfo.email.toLowerCase(),
        hashed_password: userInfo.password,
        created_at: new Date(),
        roles: [superadminRole],
        is_inactive: false,
        user_type: userInfo.user_type
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

export async function setNewPassword(password: string, token: string): Promise<boolean> {
  const { errorType, userInfo } = getInfoFromToken(token);
  if (errorType) {
    logger.error(`Error decoding token: ${errorType}`);
    return false;
  }
  if (userInfo && userInfo.email) {
    const hashedPassword = await hashPassword(password);
    const dbUser = await User.findUserByEmail(userInfo.email);
    if (!dbUser) {
      logger.error(`User [ ${userInfo.email} ] not found in the database`);
      return false;
    }
    await User.updatePassword(userInfo.email, hashedPassword);
    logger.info(`Password updated successfully for User [ ${userInfo.email} ]`);
    return true;
  }
  return false;
}

export async function recoverPassword(email: string): Promise<boolean> {
  logger.debug(`Checking if email [ ${email} ] exists`);
  const userInfo = await User.findUserByEmail(email);
  if (!userInfo) {
    logger.error(`There is no email [ ${email} ] in the database`);
    return false;
  }

  const recoverToken = createToken({
    username: '',
    email: email,
    password: '',
    companyName: '',
    user_type: 'client'
  });

  if (EMAIL_ENABLE) {
    const recoverUrl = `${process.env.HOST}/auth/forgot_password/set_new_password?token=${recoverToken}`;
    const emailService = await getEmailService();
    const emailSent = await emailService.sendTemplatedEmail({
      toEmail: email,
      subject: 'Recover Password',
      templateName: 'recover_password_email',
      templateData: { recoverUrl, email, username: userInfo.username },
    });

    if (!emailSent) {
      logger.error('Failed to send recover password email');
      return false;
    }
    logger.info(`Recover password email sent successfully for User [ ${email} ]`);
    return true;
  } else {
    logger.error('Password recovery unavailable: Automatic email functionality is not enabled or configured correctly. Please contact system administrator for manual password reset.');
    return false;
  }
}

export async function registerUser({ username, email, password, companyName }: IUserRegister): Promise<boolean> {
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

  const verificationToken = createToken({
    username: username,
    email: email,
    password: hashedPassword,
    companyName: companyName,
    user_type: 'client'
  });

  if (VERIFY_EMAIL_ENABLED && EMAIL_ENABLE) {
    const verificationUrl = `${process.env.HOST}/auth/verify_email?token=${verificationToken}`;
    const emailService = await getEmailService();
    const emailSent = await emailService.sendTemplatedEmail({
      toEmail: email,
      subject: 'Verify your email',
      templateName: 'verify_email',
      templateData: { verificationUrl, username },
    });

    if (!emailSent) {
      logger.error('Failed to send verification email');
      return false;
    }
    logger.info(`Verification email sent successfully for User [ ${email} ]`);
    return true;
  } else {
    try {
      const db = await getAdminConnection();
      await Tenant.insert(db, {
        company_name: companyName,
        email: email.toLowerCase(),
        created_at: new Date(),
      });
      const superadminRole: IRoleWithPermissions = {
        role_id: 'superadmin',
        role_name: 'superadmin',
        description: 'Superadmin role',
        permissions: []
      };
      const newUser: Omit<IUserWithRoles, 'tenant'> = {        
        user_id: uuidv4(),
        username: username.toLowerCase(),
        email: email.toLowerCase(),
        hashed_password: hashedPassword,
        created_at: new Date(),
        roles: [superadminRole],
        is_inactive: false,
        user_type: 'msp'
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
