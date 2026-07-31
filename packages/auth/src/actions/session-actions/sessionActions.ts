'use server';

import { hasPermission } from '../../lib/rbac';
import { UserSession, IUserSession } from '@alga-psa/db/models/UserSession';
import { getConnection, tenantDb } from '@alga-psa/db';
import { getSession } from '../../lib/getSession';
import { isTwoFactorEnabled, verifyTwoFactorCode } from '../../lib/twoFactorHelpers';
import { withAuth } from '../../lib/withAuth';

// Session for current user (no user info needed)
export interface SessionData extends IUserSession {
  is_current: boolean;
}

// Session with user info for admin view
export interface SessionWithUser extends IUserSession {
  user_name: string;
  user_email: string;
  user_type: string;
  is_current: boolean;
}

export interface UserSessionsResponse {
  sessions: SessionData[];
  total: number;
}

export interface AllSessionsResponse {
  sessions: SessionWithUser[];
  total: number;
}

export interface AuthSessionPermissionError {
  readonly permissionError: string;
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

function permissionError(message: string): AuthSessionPermissionError {
  return { permissionError: message };
}

function revokeSessionFailure(message: string): RevokeSessionResult {
  return {
    success: false,
    is_current: false,
    message,
  };
}

function revokeAllSessionsFailure(message: string): RevokeAllSessionsResult {
  return {
    success: false,
    revoked_count: 0,
    message,
  };
}

/**
 * Get current user's active sessions
 */
export const getUserSessionsAction = withAuth(async (currentUser, { tenant }): Promise<UserSessionsResponse> => {
  const session = await getSession();
  const currentSessionId = (session as any)?.session_id;

  const sessions = await UserSession.getUserSessions(
    tenant,
    currentUser.user_id
  );

  // Mark current session
  const sessionsWithCurrent: SessionData[] = sessions.map(sess => ({
    ...sess,
    is_current: sess.session_id === currentSessionId
  }));

  return {
    sessions: sessionsWithCurrent,
    total: sessionsWithCurrent.length
  };
});

/**
 * Get all users' active sessions (admin only)
 */
export const getAllSessionsAction = withAuth(async (currentUser, { tenant }): Promise<AllSessionsResponse | AuthSessionPermissionError> => {
  // Check if user has permission to read security settings
  const canReadSecuritySettings = await hasPermission(
    currentUser,
    'security_settings',
    'read'
  );

  if (!canReadSecuritySettings) {
    return permissionError('Permission denied: You do not have permission to view all sessions.');
  }

  const knex = await getConnection(tenant);

  // Get all active sessions with user information
  const db = tenantDb(knex, tenant);
  const sessionsQuery = db.table('sessions')
    .select(
      'sessions.*',
      knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as user_name`),
      'users.email as user_email',
      'users.user_type as user_type'
    );
  db.tenantJoin(sessionsQuery, 'users', 'sessions.user_id', 'users.user_id', { type: 'left' });

  const sessionsWithUsers = await sessionsQuery
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
    is_current: sess.user_id === currentUser.user_id,
    // Ensure required fields have defaults if user is deleted
    user_name: sess.user_name || 'Unknown User',
    user_email: sess.user_email || 'unknown@example.com',
    user_type: sess.user_type || 'internal'
  }));

  return {
    sessions,
    total: sessions.length
  };
});

/**
 * Revoke a specific session
 */
export const revokeSessionAction = withAuth(async (currentUser, { tenant }, sessionId: string): Promise<RevokeSessionResult> => {
  const session = await getSession();

  if (!session?.user?.id) {
    return revokeSessionFailure('Unauthorized. Sign in again to manage sessions.');
  }

  // Verify the session belongs to the current user OR user has admin permission
  const targetSession = await UserSession.findById(
    tenant,
    sessionId
  );

  if (!targetSession) {
    return revokeSessionFailure('Session not found. It may have already expired or been revoked.');
  }

  // Check if user has permission to update security settings (admin action)
  const canUpdateSecuritySettings = await hasPermission(
    currentUser,
    'security_settings',
    'update'
  );

  // Allow if session belongs to user OR user has admin permission
  if (targetSession.user_id !== currentUser.user_id && !canUpdateSecuritySettings) {
    return revokeSessionFailure('You do not have permission to revoke this session.');
  }

  // Check if this is the current session
  const currentSessionId = (session as any).session_id;
  const isCurrentSession = sessionId === currentSessionId;

  // Determine revocation reason
  const isAdminRevokingOther = canUpdateSecuritySettings && targetSession.user_id !== currentUser.user_id;
  const revocationReason = isAdminRevokingOther ? 'admin_revoke' : 'user_logout';

  // Revoke the session
  await UserSession.revokeSession(
    tenant,
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
});

/**
 * Revoke all other sessions (except current)
 */
export const revokeAllOtherSessionsAction = withAuth(async (
  currentUser,
  { tenant },
  params?: RevokeAllSessionsParams
): Promise<RevokeAllSessionsResult> => {
  const session = await getSession();

  if (!session?.user?.id) {
    return revokeAllSessionsFailure('Unauthorized. Sign in again to manage sessions.');
  }

  const currentSessionId = (session as any).session_id;

  if (!currentSessionId) {
    return revokeAllSessionsFailure('Current session could not be identified. Sign in again and retry.');
  }

  // Check if user has 2FA enabled
  const has2FA = await isTwoFactorEnabled(tenant, currentUser.user_id);

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
      tenant,
      currentUser.user_id,
      twoFactorCode
    );

    if (!isValid) {
      return revokeAllSessionsFailure('Invalid 2FA code');
    }
  }

  // Revoke all other sessions
  const revokedCount = await UserSession.revokeAllExcept(
    tenant,
    currentUser.user_id,
    currentSessionId
  );

  return {
    success: true,
    revoked_count: revokedCount,
    message: `Successfully logged out from ${revokedCount} other device${revokedCount !== 1 ? 's' : ''}`
  };
});
