'use server'

import { createTenantKnex, tenantDb, runWithTenant, runAsSystem, createSystemContext } from '@alga-psa/db';
import { UserInvitationService } from '../../services/UserInvitationService';
import { getSystemEmailService, TenantEmailService, sendTeamInvitationEmail } from '@alga-psa/email';
import { hasPermission } from '@alga-psa/user-composition/lib/permissions';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import { isValidEmail } from '@alga-psa/core';
import { validatePassword } from '@alga-psa/validation';
import type { IUserWithRoles } from '@alga-psa/types';
import { checkInternalUserLicenseLimit, isInternalUserLicenseLimitRejected } from '../../lib/internalUserLicenseGuard';

export type UserInvitationErrorCode =
  | 'PERMISSION_DENIED_INVITE'
  | 'TENANT_CONTEXT_REQUIRED'
  | 'EMAIL_NOT_CONFIGURED'
  | 'EMAIL_ALREADY_EXISTS'
  | 'INVALID_EMAIL'
  | 'ROLE_REQUIRED'
  | 'INVALID_ROLE'
  | 'INVITATION_FAILED'
  | 'BASE_URL_NOT_CONFIGURED'
  | 'TOKEN_REQUIRED'
  | 'TOKEN_AND_PASSWORD_REQUIRED'
  | 'PASSWORD_POLICY'
  | 'INVALID_OR_EXPIRED_TOKEN'
  | 'CREATE_USER_FAILED'
  | 'VERIFICATION_FAILED'
  | 'SETUP_FAILED'
  | 'INVITATION_NOT_FOUND'
  | 'REVOKE_FAILED'
  | 'SOLO_PLAN_LIMIT'
  | 'LICENSE_LIMIT_REACHED';

interface SendUserInvitationParams {
  email: string;
  firstName: string;
  lastName: string;
  roleId: string;
}

class UserInvitationError extends Error {
  constructor(message: string, public readonly errorCode: UserInvitationErrorCode) {
    super(message);
    this.name = 'UserInvitationError';
  }
}

function normalizeSendUserInvitationError(
  error: unknown
): { message?: string; errorCode: UserInvitationErrorCode } {
  if (error instanceof UserInvitationError) {
    return { message: error.message.trim() || undefined, errorCode: error.errorCode };
  }

  if (error instanceof Error) {
    const message = error.message.trim();
    if (message === 'Unauthorized') {
      return { message: 'Permission denied: Cannot invite users', errorCode: 'PERMISSION_DENIED_INVITE' };
    }
    if (message === 'Tenant is required') {
      return { message: 'Tenant context is required', errorCode: 'TENANT_CONTEXT_REQUIRED' };
    }
    if (message.startsWith('Too many attempts.')) {
      return { message, errorCode: 'INVITATION_FAILED' };
    }
    if (message === 'Failed to create invitation') {
      return { errorCode: 'INVITATION_FAILED' };
    }
  }

  return { errorCode: 'INVITATION_FAILED' };
}

/**
 * Send an email invitation to a not-yet-created internal (MSP) team member.
 * Mirrors sendPortalInvitation, but the invitee has no contact row — the
 * user account is created only once they accept and set a password.
 */
export const sendUserInvitation = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  params: SendUserInvitationParams
): Promise<{ success: boolean; invitationId?: string; message?: string; error?: string; errorCode?: UserInvitationErrorCode }> => {
  try {
    const { knex } = await createTenantKnex();

    if (!await hasPermission(user, 'user', 'invite', knex)) {
      return { success: false, error: 'Permission denied: Cannot invite users', errorCode: 'PERMISSION_DENIED_INVITE' };
    }

    if (!tenant) {
      throw new Error('Tenant is required');
    }

    const normalizedEmail = (params.email || '').trim().toLowerCase();
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      return { success: false, error: 'Please enter a valid email address', errorCode: 'INVALID_EMAIL' };
    }

    if (!params.roleId) {
      return { success: false, error: 'Role is required', errorCode: 'ROLE_REQUIRED' };
    }

    const role = await tenantDb(knex, tenant).table('roles')
      .where({ role_id: params.roleId, msp: true })
      .first();
    if (!role) {
      return { success: false, error: 'Invalid role selected', errorCode: 'INVALID_ROLE' };
    }

    const existingUser = await tenantDb(knex, tenant).table('users')
      .where({ email: normalizedEmail, user_type: 'internal' })
      .first();
    if (existingUser) {
      return { success: false, error: 'A user with this email address already exists', errorCode: 'EMAIL_ALREADY_EXISTS' };
    }

    // Same seat-limit enforcement addUser applies to a direct password-based
    // creation — an accepted invitation creates an internal user account just
    // the same, so it must be held to the same limit. Re-checked again at
    // acceptance time in completeUserInvitationSetup, since seats can fill up
    // (or shrink) between the invite being sent and accepted.
    //
    // Other pending invitations reserve seats here: without that, an admin
    // with one seat left could send any number of invites and every invitee
    // past the first would only find out at acceptance, after choosing a
    // password. This invitee's own pending invitation is excluded so a
    // resend never blocks itself.
    const pendingRow = await tenantDb(knex, tenant).table('user_invitations')
      .whereNull('used_at')
      .whereNot('email', normalizedEmail)
      .where('expires_at', '>', knex.fn.now())
      .count('* as count')
      .first();
    const reservedSeats = parseInt(String(pendingRow?.count ?? '0'), 10);

    const licenseCheck = await checkInternalUserLicenseLimit(knex, tenant, { reservedSeats });
    if (isInternalUserLicenseLimitRejected(licenseCheck)) {
      return { success: false, error: licenseCheck.error, errorCode: licenseCheck.code };
    }

    const tenantEmailService = TenantEmailService.getInstance(tenant);
    let emailConfigured = await tenantEmailService.isConfigured();
    if (!emailConfigured) {
      const systemEmailService = await getSystemEmailService();
      emailConfigured = await systemEmailService.isConfigured();
      if (!emailConfigured) {
        const initError = await tenantEmailService.getInitializationError();
        return {
          success: false,
          error: initError ? `Email provider not ready: ${initError}` : 'Email service is disabled or not configured',
          errorCode: 'EMAIL_NOT_CONFIGURED'
        };
      }
    }

    const result = await knex.transaction(async (trx) => {
      const scopedDb = tenantDb(trx, tenant);

      const invitationResult = await UserInvitationService.createInvitationWithTransaction(
        { email: normalizedEmail, firstName: params.firstName, lastName: params.lastName, roleId: params.roleId },
        trx
      );
      if (!invitationResult.success) {
        throw new UserInvitationError(
          invitationResult.error || 'Team invitation could not be created. Please try again.',
          'INVITATION_FAILED'
        );
      }

      // MSP's own name — same "default client" lookup used for portal invitations.
      const tenantDefaultClientQuery = scopedDb.table('tenant_companies')
        .where({ 'tenant_companies.is_default': true })
        .select('clients.client_name')
        .first();
      scopedDb.tenantJoin(tenantDefaultClientQuery, 'clients', 'clients.client_id', 'tenant_companies.client_id');
      const tenantDefaultClient = await tenantDefaultClientQuery as { client_name: string } | undefined;

      const baseUrl =
        process.env.NEXT_PUBLIC_BASE_URL ||
        process.env.NEXTAUTH_URL ||
        (process.env.HOST ? `https://${process.env.HOST}` : '');

      if (!baseUrl) {
        throw new UserInvitationError('Base URL is not configured for team invitations', 'BASE_URL_NOT_CONFIGURED');
      }

      const setupUrl = new URL('/auth/team/setup', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
      setupUrl.searchParams.set('token', invitationResult.token || '');
      const inviteLink = setupUrl.toString();

      const invitedByName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username;

      await sendTeamInvitationEmail({
        email: normalizedEmail,
        teamMemberName: `${params.firstName} ${params.lastName}`.trim(),
        tenantName: tenantDefaultClient?.client_name || 'your team',
        roleName: role.role_name,
        invitedByName,
        inviteLink,
        expirationTime: '24 hours',
        tenant
      });

      return {
        success: true,
        invitationId: invitationResult.invitationId,
        message: `Invitation sent successfully to ${normalizedEmail}`
      };
    }).catch((error) => {
      console.error('Team invitation transaction failed:', error);
      const normalized = normalizeSendUserInvitationError(error);
      return { success: false, error: normalized.message, errorCode: normalized.errorCode };
    });

    return result;
  } catch (error) {
    console.error('Error sending team invitation:', error);
    const normalized = normalizeSendUserInvitationError(error);
    return { success: false, error: normalized.message, errorCode: normalized.errorCode };
  }
});

/**
 * Verify a team invitation token (public — called from the unauthenticated
 * acceptance page before the invitee has any session).
 */
export async function verifyUserInvitationToken(token: string): Promise<{
  success: boolean;
  invitee?: { email: string; first_name: string; last_name: string; role_name: string | null };
  error?: string;
  errorCode?: UserInvitationErrorCode;
}> {
  try {
    if (!token) {
      return { success: false, error: 'Token is required', errorCode: 'TOKEN_REQUIRED' };
    }

    const verificationResult = await UserInvitationService.verifyToken(token);
    if (!verificationResult.valid || !verificationResult.invitee) {
      return {
        success: false,
        error: verificationResult.error || 'Invalid token',
        errorCode: verificationResult.errorCode || 'INVALID_OR_EXPIRED_TOKEN'
      };
    }

    return { success: true, invitee: verificationResult.invitee };
  } catch (error) {
    console.error('Error verifying team invitation token:', error);
    return { success: false, error: 'Failed to verify token', errorCode: 'VERIFICATION_FAILED' };
  }
}

/**
 * Complete team invitation setup by creating the internal user account with
 * the password the invitee chose.
 */
export async function completeUserInvitationSetup(
  token: string,
  password: string
): Promise<{ success: boolean; userId?: string; username?: string; message?: string; error?: string; errorCode?: UserInvitationErrorCode }> {
  try {
    if (!token || !password) {
      return { success: false, error: 'Token and password are required', errorCode: 'TOKEN_AND_PASSWORD_REQUIRED' };
    }

    // Full policy, not just length: this action is reachable without a
    // session, so the accept page's client-side checks are advisory only.
    const passwordPolicyError = validatePassword(password);
    if (passwordPolicyError) {
      return { success: false, error: passwordPolicyError, errorCode: 'PASSWORD_POLICY' };
    }

    const verificationResult = await UserInvitationService.verifyToken(token);
    if (!verificationResult.valid || !verificationResult.invitee || !verificationResult.tenant) {
      return { success: false, error: 'Invalid or expired invitation token', errorCode: 'INVALID_OR_EXPIRED_TOKEN' };
    }

    const tenantFromInvitation = verificationResult.tenant;
    const invitee = verificationResult.invitee;

    const result = await runWithTenant(tenantFromInvitation, async () => {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        return { success: false, error: 'Tenant context is required', errorCode: 'TENANT_CONTEXT_REQUIRED' } as const;
      }

      const scopedDb = tenantDb(knex, tenant);

      const existingUser = await scopedDb.table('users')
        .where({ email: invitee.email, user_type: 'internal' })
        .first();
      if (existingUser) {
        return { success: false, error: 'A user account already exists for this email address', errorCode: 'CREATE_USER_FAILED' } as const;
      }

      // Re-check the seat limit here, not just at invite time: this is where
      // the account row actually gets created (via runAsSystem, bypassing the
      // permission-gated path addUser uses), and seats can have filled up
      // between the invite being sent and this acceptance.
      const licenseCheck = await checkInternalUserLicenseLimit(knex, tenant);
      if (isInternalUserLicenseLimitRejected(licenseCheck)) {
        return { success: false, error: licenseCheck.error, errorCode: licenseCheck.code } as const;
      }

      // The invitation's role must still exist — creating the account without
      // it would hand the invitee a working login that can't see anything,
      // while reporting success. Fail instead so the admin re-invites with a
      // current role.
      const invitationRoleId = verificationResult.invitation?.role_id;
      const invitationRole = invitationRoleId
        ? await scopedDb.table('roles').where({ role_id: invitationRoleId }).first()
        : undefined;
      if (!invitationRole) {
        return {
          success: false,
          error: 'The role for this invitation no longer exists. Please ask your administrator to send a new invitation.',
          errorCode: 'INVALID_ROLE'
        } as const;
      }

      let newUser;
      try {
        newUser = await runAsSystem('user-invitation-account-creation', async () => {
          // Deferred: loading UserService (and its @alga-psa/db BaseService
          // base class) eagerly would pull it into every consumer of this
          // barrel-exported action file, e.g. read-only routes that only
          // need findUserByIdForApi.
          const { UserService } = await import('../../services/UserService');
          const userService = new UserService();
          const systemContext = createSystemContext(tenant);

          const user = await userService.create({
            username: invitee.email,
            email: invitee.email,
            password,
            first_name: invitee.first_name,
            last_name: invitee.last_name,
            user_type: 'internal',
            is_inactive: false,
            two_factor_enabled: false,
            is_google_user: false,
            // Assigned inside UserService.create's own transaction, so the
            // account and its role land (or fail) together.
            role_ids: [invitationRole.role_id]
          }, systemContext);

          if (!user || !user.user_id) {
            throw new UserInvitationError('Team member account could not be created. Please try again.', 'CREATE_USER_FAILED');
          }

          return user;
        });
      } catch (error) {
        console.error('Error creating team member account:', error);
        const normalized = normalizeSendUserInvitationError(error);
        return { success: false, error: normalized.message, errorCode: normalized.errorCode || 'CREATE_USER_FAILED' } as const;
      }

      try {
        const UserPreferences = await import('@alga-psa/db').then(m => m.UserPreferences);
        await UserPreferences.upsert(knex, {
          user_id: newUser.user_id,
          setting_name: 'has_reset_password',
          setting_value: true,
          updated_at: new Date()
        });
      } catch (prefError) {
        console.warn('Failed to set password reset preference:', prefError);
      }

      const tokenMarked = await UserInvitationService.markTokenAsUsed(token);
      if (!tokenMarked) {
        console.warn('Failed to mark team invitation token as used');
      }

      await UserInvitationService.cleanupExpiredTokens();

      return {
        success: true,
        userId: newUser.user_id,
        username: invitee.email,
        message: 'Account created successfully'
      } as const;
    });

    return result;
  } catch (error) {
    console.error('Error completing team invitation setup:', error);
    return { success: false, error: 'Failed to complete account setup', errorCode: 'SETUP_FAILED' };
  }
}

/**
 * Get invitation history for the current tenant (Settings > Users list).
 */
export const getUserInvitations = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext
): Promise<Array<{ invitation_id: string; email: string; first_name: string; last_name: string; created_at: string; expires_at: string; used_at?: string; status: 'pending' | 'expired' | 'used' | 'revoked' }>> => {
  try {
    const { knex } = await createTenantKnex();
    if (!await hasPermission(user, 'user', 'read', knex)) {
      return [];
    }

    const invitations = await UserInvitationService.getInvitationHistory();

    return invitations.map(invitation => {
      let status: 'pending' | 'expired' | 'used' | 'revoked' = 'pending';
      if (invitation.used_at) {
        status = invitation.metadata?.revoked ? 'revoked' : 'used';
      } else if (new Date(invitation.expires_at) < new Date()) {
        status = 'expired';
      }

      return {
        invitation_id: invitation.invitation_id,
        email: invitation.email,
        first_name: invitation.first_name,
        last_name: invitation.last_name,
        created_at: invitation.created_at.toISOString(),
        expires_at: invitation.expires_at.toISOString(),
        used_at: invitation.used_at?.toISOString(),
        status
      };
    });
  } catch (error) {
    console.error('Error fetching team invitations:', error);
    return [];
  }
});

/**
 * Revoke a pending team invitation.
 */
export const revokeUserInvitation = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  invitationId: string
): Promise<{ success: boolean; error?: string; errorCode?: UserInvitationErrorCode }> => {
  try {
    const { knex } = await createTenantKnex();
    if (!await hasPermission(user, 'user', 'invite', knex)) {
      return { success: false, error: 'Permission denied: Cannot revoke team invitations', errorCode: 'PERMISSION_DENIED_INVITE' };
    }

    const revoked = await UserInvitationService.revokeInvitation(invitationId);
    if (!revoked) {
      return { success: false, error: 'Invitation not found or already used', errorCode: 'INVITATION_NOT_FOUND' };
    }

    return { success: true };
  } catch (error) {
    console.error('Error revoking team invitation:', error);
    return { success: false, errorCode: 'REVOKE_FAILED' };
  }
});
