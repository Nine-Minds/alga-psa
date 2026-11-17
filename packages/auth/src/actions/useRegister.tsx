"use server";
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
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
import { resolvePasswordResetOrigin } from '../lib/resetLinkOrigin';
import { checkPasswordResetLimit } from '../lib/security/rateLimiting';
import { getActiveClientPortalDomainForTenant } from '../lib/portalDomainTenant';
import {
  resolveResetSubjects,
  resolveResetSubjectFromToken,
  type ResolvedResetSubject,
} from '../lib/passwordReset';

const VERIFY_EMAIL_ENABLED = process.env.VERIFY_EMAIL_ENABLED === 'true';
const EMAIL_ENABLE = process.env.EMAIL_ENABLE === 'true';

interface VerifyResponse {
  message: string;
  wasSuccess: boolean;
}

export async function verifyRegisterUser(token: string): Promise<VerifyResponse> {
  const { t } = await getServerTranslation(undefined, 'client-portal');
  logger.system('Verifying user registration');
  const { messageKey, userInfo } = await getInfoFromToken(token);
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
        description: t('auth.registration.superadminRole'),
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
        message: t('auth.registration.messages.verified'),
        wasSuccess: true,
      };
    } catch (error) {
      logger.error('Error verifying and registering user:', error);
      return {
        message: t('auth.registration.errors.verifyFailed'),
        wasSuccess: false,
      };
    }
  }
  return {
    message: t(messageKey || 'auth.registration.errors.invalidToken'),
    wasSuccess: false,
  };
}

export async function getAccountInfoFromToken(token: string, portal: string) {
  try {
    const { t } = await getServerTranslation(undefined, 'client-portal');
    const resolved = await resolveResetSubjectFromToken(token);
    if (!resolved) {
      return null;
    }
    const { subject, user } = resolved;

    return {
      name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || t('auth.registration.user'),
      email: subject.email,
      username: user.username || subject.email,
      accountType: portal === 'client' ? t('auth.registration.clientPortalUser') : t('auth.registration.mspUser')
    };
  } catch (error) {
    logger.error('Error getting account info from token:', error);
    return null;
  }
}

export async function setNewPassword(password: string, token: string): Promise<boolean> {
  const resolved = await resolveResetSubjectFromToken(token);
  if (!resolved) {
    logger.error('Refusing password set: reset token does not name a valid user');
    return false;
  }
  const { subject, user } = resolved;

  // Tenant login policy: a token minted before SSO was required must not set a password afterwards.
  const { isPasswordResetPermitted } = await import('../lib/passwordLoginGate');
  if (!(await isPasswordResetPermitted(user, 'password_reset_complete'))) {
    return false;
  }

  const hashedPassword = await hashPassword(password);
  await User.updatePassword(subject.user_id, subject.tenant, hashedPassword);
  logger.info(`Password updated successfully for User [ ${subject.email} ] type [ ${subject.user_type} ] id [ ${subject.user_id} ] tenant [ ${subject.tenant} ]`);
  return true;
}

export interface RecoverPasswordOptions {
  /** Vanity client-portal host the request arrived on. */
  portalDomain?: string;
  /** Public organization slug (scoped MSP sign-in). */
  tenantSlug?: string;
}

export async function recoverPassword(
  email: string,
  portal: 'msp' | 'client' = 'msp',
  options: RecoverPasswordOptions | string = {}
): Promise<boolean> {
  // A bare string is the portal domain (the form existing callers use).
  const { portalDomain, tenantSlug }: RecoverPasswordOptions =
    typeof options === 'string' ? { portalDomain: options } : options ?? {};
  // Normalize the address once; validation, lookup, token payload, recipient,
  // and logging all share this value.
  const normalizedEmail = email.trim().toLowerCase();
  // For MSP portal, look for 'internal' users; for client portal, look for 'client' users
  const userType = portal === 'msp' ? 'internal' : 'client';

  // Every outcome below resolves to the same generic success value: an
  // unauthenticated requester must never learn whether an account exists, how
  // many organizations it spans, or whether delivery succeeded.

  // Invalid format is indistinguishable from an unknown address: finish with
  // the generic success result without a lookup or send attempt.
  if (!isValidEmail(normalizedEmail)) {
    logger.debug('Password recovery skipped: invalid email format', { portal, userType });
    return true;
  }

  try {
    // One budget per mailbox per request, shared with tenant discovery, spent
    // before any lookup and independent of whether an account exists. A request
    // that fans out to several tenants still costs one.
    const limit = await checkPasswordResetLimit(normalizedEmail);
    if (!limit.success) {
      logger.info('Password recovery skipped: rate limited', { portal, userType });
      return true;
    }

    logger.debug('Resolving password reset subjects', { portal, userType });
    const subjects = await resolveResetSubjects(normalizedEmail, userType, { portalDomain, tenantSlug });
    if (subjects.length === 0) {
      logger.debug('Password recovery skipped: no active matching user', { portal, userType });
      return true;
    }

    // Each subject is answered for by its own tenant, independently: a refusal or
    // failure for one never suppresses the others.
    for (const resolved of subjects) {
      await sendResetForSubject(resolved, { portal, portalDomain, onlySubject: subjects.length === 1 });
    }
    return true;
  } catch (error) {
    // Resolution failures resolve to the same public success value. Operators
    // observe failures through structured application logs.
    logger.error('password_recovery_send_failed', {
      portal,
      userType,
      error: error instanceof Error ? error.message : String(error)
    });
    return true;
  }
}

async function sendResetForSubject(
  { subject, user }: ResolvedResetSubject,
  context: { portal: 'msp' | 'client'; portalDomain?: string; onlySubject: boolean }
): Promise<void> {
  const { portal } = context;
  const userType = subject.user_type;
  try {
    // Tenant login policy: with SSO required, internal non-break-glass users get no
    // reset email. Same generic success result as an unknown address.
    const { isPasswordResetPermitted } = await import('../lib/passwordLoginGate');
    if (!(await isPasswordResetPermitted(user, 'password_reset_request'))) {
      logger.debug('Password recovery skipped: SSO is required for this user', { portal, userType });
      return;
    }

    // Provider readiness is decided by the send path, not by an environment
    // flag here. An enabled tenant SMTP/Resend/Microsoft provider therefore
    // works even when EMAIL_ENABLE is false or unset; the system fallback
    // remains controlled by SystemEmailProviderFactory and EMAIL_ENABLE.
    //
    // The reset link origin may only come from trusted server-side
    // configuration. Request-derived headers are never consulted (reset-link
    // poisoning). If no trusted origin exists, refuse the send: it must be
    // impossible for a reset email whose link begins with "undefined" (or any
    // non-absolute origin) to reach a provider.
    const resetOrigin = resolvePasswordResetOrigin();
    if (!resetOrigin) {
      logger.error('password_recovery_send_refused', {
        portal,
        userType,
        tenant: subject.tenant,
        error:
          'No trusted public origin configured for password-reset links. ' +
          'Set NEXT_PUBLIC_BASE_URL (or NEXTAUTH_URL, or HOST) to the public ' +
          'application URL; the reset email was not sent.'
      });
      return;
    }

    const recoverToken = await createToken({
      username: '',
      email: subject.email,
      password: '',
      clientName: '',
      user_type: subject.user_type,
      tenant: subject.tenant,
      user_id: subject.user_id
    });

    // The set-password page is branded by the portal domain in the link: this
    // tenant's own domain when it has one (so a fan-out email names its sender's
    // portal), otherwise the requested host when it is the only candidate.
    const ownDomain = portal === 'client'
      ? await getActiveClientPortalDomainForTenant(subject.tenant, context.portalDomain)
      : null;
    const linkDomain = ownDomain ?? (context.onlySubject ? context.portalDomain : undefined);

    const resetLink = buildPasswordResetLink(
      resetOrigin,
      recoverToken,
      portal,
      linkDomain
    );

    const { t } = await getServerTranslation(undefined, 'client-portal');
    // Use the proper sendPasswordResetEmail function which respects language hierarchy
    await getAuthEmailRegistry().sendPasswordResetEmail({
      email: subject.email,
      userName: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || subject.email,
      resetLink,
      expirationTime: t('auth.registration.resetExpiration'),
      tenant: subject.tenant,
      supportEmail: 'support@algapsa.com',
      clientName: 'AlgaPSA'
    });

    logger.info('Password recovery email sent successfully', {
      portal,
      userType,
      tenant: subject.tenant,
      email: subject.email
    });
  } catch (error) {
    // Token, link and send failures stay out of the public result. Operators
    // observe them through structured logs and the Email Log. The token and
    // reset URL are never logged.
    logger.error('password_recovery_send_failed', {
      portal,
      userType,
      tenant: subject.tenant,
      error: error instanceof Error ? error.message : String(error)
    });
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
    
    const { t } = await getServerTranslation(undefined, 'client-portal');
    // Use SystemEmailService for email verification
    const systemEmailService = await getAuthEmailRegistry().getSystemEmailService();
    const emailResult = await systemEmailService.sendEmailVerification({
      email: email,
      verificationUrl: verificationUrl,
      clientName: clientName,
      expirationTime: t('auth.registration.verificationExpiration')
    });

    if (!emailResult.success) {
      logger.error('Failed to send verification email:', emailResult.error);
      return false;
    }
    logger.info(`Verification email sent successfully for User [ ${email} ]`);
    return true;
  } else {
    try {
      const { t } = await getServerTranslation(undefined, 'client-portal');
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
        description: t('auth.registration.superadminRole'),
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
