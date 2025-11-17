'use server';

import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { UserSession, IUserSession } from 'server/src/lib/models/UserSession';
import { getConnection } from 'server/src/lib/db/db';
import { getSession } from 'server/src/lib/auth/getSession';
import { isTwoFactorEnabled, verifyTwoFactorCode } from 'server/src/lib/auth/twoFactorHelpers';

interface SessionWithUser extends IUserSession {
  user_name?: string;
  user_email?: string;
  user_type?: string;
  is_current: boolean;
}

export interface SessionsResponse {
  sessions: SessionWithUser[];
  total: number;
}

export interface RevokeSessionResult {
  success: boolean;
  is_current: boolean;
  message: string;
}

export interface RevokeAllSessionsParams {
  two_factor_code?: string;
}

export interface RevokeAllSessionsResult {
  success: boolean;
  revoked_count: number;
  requires_2fa?: boolean;
  message: string;
}

/**
 * Get current user's active sessions
 */
export async function getUserSessionsAction(): Promise<SessionsResponse> {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('Unauthorized');
  }

  const session = await getSession();
  const currentSessionId = (session as any)?.session_id;

  const sessions = await UserSession.getUserSessions(
    currentUser.tenant,
    currentUser.user_id
  );

  // Mark current session
  const sessionsWithCurrent = sessions.map(sess => ({
    ...sess,
    is_current: sess.session_id === currentSessionId
  }));

  return {
    sessions: sessionsWithCurrent,
    total: sessionsWithCurrent.length
  };
}

/**
 * Get all users' active sessions (admin only)
 */
export async function getAllSessionsAction(): Promise<SessionsResponse> {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('Unauthorized');
  }

  // Check if user has permission to read security settings
  const canReadSecuritySettings = await hasPermission(
    currentUser,
    'security_settings',
    'read'
  );

  if (!canReadSecuritySettings) {
    throw new Error('Forbidden: Insufficient permissions to view all sessions');
  }

  const knex = await getConnection(currentUser.tenant);

  // Get all active sessions with user information
  const sessionsWithUsers = await knex('sessions')
    .select(
      'sessions.*',
      knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as user_name`),
      'users.email as user_email',
      'users.user_type as user_type'
    )
    .leftJoin('users', function() {
      this.on('sessions.user_id', '=', 'users.user_id')
        .andOn('sessions.tenant', '=', 'users.tenant');
    })
    .where('sessions.tenant', currentUser.tenant)
    .whereNull('sessions.revoked_at')
    .where('sessions.expires_at', '>', knex.fn.now())
    .orderBy('sessions.last_activity_at', 'desc');

  // Parse location_data if needed (defensive)
  const sessions: SessionWithUser[] = sessionsWithUsers.map((sess: any) => ({
    ...sess,
    location_data: typeof sess.location_data === 'string'
      ? JSON.parse(sess.location_data)
      : sess.location_data,
    // Mark sessions belonging to current user
    is_current: sess.user_id === currentUser.user_id
  }));

  return {
    sessions,
    total: sessions.length
  };
}

/**
 * Revoke a specific session
 */
export async function revokeSessionAction(sessionId: string): Promise<RevokeSessionResult> {
  const session = await getSession();
  const currentUser = await getCurrentUser();

  if (!currentUser || !session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Verify the session belongs to the current user OR user has admin permission
  const targetSession = await UserSession.findById(
    currentUser.tenant,
    sessionId
  );

  if (!targetSession) {
    throw new Error('Session not found');
  }

  // Check if user has permission to update security settings (admin action)
  const canUpdateSecuritySettings = await hasPermission(
    currentUser,
    'security_settings',
    'update'
  );

  // Allow if session belongs to user OR user has admin permission
  if (targetSession.user_id !== currentUser.user_id && !canUpdateSecuritySettings) {
    throw new Error('Forbidden - This session does not belong to you');
  }

  // Check if this is the current session
  const currentSessionId = (session as any).session_id;
  const isCurrentSession = sessionId === currentSessionId;

  // Determine revocation reason
  const isAdminRevokingOther = canUpdateSecuritySettings && targetSession.user_id !== currentUser.user_id;
  const revocationReason = isAdminRevokingOther ? 'admin_revoke' : 'user_logout';

  // Revoke the session
  await UserSession.revokeSession(
    currentUser.tenant,
    sessionId,
    revocationReason
  );

  return {
    success: true,
    is_current: isCurrentSession,
    message: isCurrentSession
      ? 'Current session revoked - you will be logged out'
      : 'Session revoked successfully'
  };
}

/**
 * Revoke all other sessions (except current)
 */
export async function revokeAllOtherSessionsAction(
  params?: RevokeAllSessionsParams
): Promise<RevokeAllSessionsResult> {
  const session = await getSession();
  const currentUser = await getCurrentUser();

  if (!currentUser || !session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const currentSessionId = (session as any).session_id;

  if (!currentSessionId) {
    throw new Error('Current session ID not found');
  }

  // Check if user has 2FA enabled
  const has2FA = await isTwoFactorEnabled(currentUser.tenant, currentUser.user_id);

  if (has2FA) {
    const twoFactorCode = params?.two_factor_code;

    if (!twoFactorCode) {
      return {
        success: false,
        revoked_count: 0,
        requires_2fa: true,
        message: '2FA verification required'
      };
    }

    const isValid = await verifyTwoFactorCode(
      currentUser.tenant,
      currentUser.user_id,
      twoFactorCode
    );

    if (!isValid) {
      throw new Error('Invalid 2FA code');
    }
  }

  // Revoke all other sessions
  const revokedCount = await UserSession.revokeAllExcept(
    currentUser.tenant,
    currentUser.user_id,
    currentSessionId
  );

  return {
    success: true,
    revoked_count: revokedCount,
    message: `Successfully logged out from ${revokedCount} other device${revokedCount !== 1 ? 's' : ''}`
  };
}
