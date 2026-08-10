/**
 * UserSession Model
 *
 * Manages user session records in the database for session tracking,
 * device recognition, and concurrent session enforcement.
 */

import type { Knex } from 'knex';
import { getConnection } from '../lib/tenant';
import { tenantDb } from '../lib/tenantDb';

export interface LocationData {
  city?: string;
  country?: string;
  countryCode?: string;
  timezone?: string;
  latitude?: number;
  longitude?: number;
}

export interface IUserSession {
  tenant: string;
  session_id: string;
  user_id: string;
  ip_address: string | null;
  location_data: LocationData | null;
  user_agent: string | null;
  device_fingerprint: string | null;
  device_name: string | null;
  device_type: string | null;
  last_activity_at: Date;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
  login_method: string | null;
}

export interface CreateSessionParams {
  tenant: string;
  user_id: string;
  ip_address: string;
  user_agent: string;
  device_fingerprint: string;
  device_name: string;
  device_type: string;
  location_data?: LocationData | null;
  expires_at: Date;
  login_method: string;
}

export interface SessionIdentity {
  userId: string;
  userType: 'internal' | 'client';
}

export type RevocationReason =
  | 'user_logout'
  | 'user_logout_all'
  | 'admin_revoke'
  | 'max_sessions'
  | 'security'
  | 'scim'
  | 'inactivity'
  | 'expired';

function sessions<Row extends object = IUserSession>(
  conn: Knex | Knex.Transaction,
  tenant: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(conn, tenant).table<Row>('sessions');
}

export class UserSession {
  static async create(params: CreateSessionParams): Promise<string> {
    const knex = await getConnection(params.tenant);

    const [session] = await sessions<Record<string, any>>(knex, params.tenant)
      .insert({
        tenant: params.tenant,
        user_id: params.user_id,
        token: '',
        ip_address: params.ip_address,
        user_agent: params.user_agent,
        device_fingerprint: params.device_fingerprint,
        device_name: params.device_name,
        device_type: params.device_type,
        location_data: params.location_data || null,
        expires_at: params.expires_at,
        login_method: params.login_method,
        last_activity_at: knex.fn.now(),
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      })
      .returning('session_id');

    return (session as any).session_id;
  }

  static async findById(tenant: string, sessionId: string): Promise<IUserSession | null> {
    const knex = await getConnection(tenant);

    const session = await sessions(knex, tenant).where({ session_id: sessionId }).first();

    return session || null;
  }

  static async getUserSessions(tenant: string, userId: string): Promise<IUserSession[]> {
    const knex = await getConnection(tenant);

    const sessionsForUser = await sessions(knex, tenant)
      .where({ user_id: userId })
      .whereNull('revoked_at')
      .where('expires_at', '>', knex.fn.now())
      .orderBy('last_activity_at', 'desc');

    return sessionsForUser.map((session: any) => ({
      ...session,
      location_data: typeof session.location_data === 'string' ? JSON.parse(session.location_data) : session.location_data,
    }));
  }

  static async getActiveSessionCount(tenant: string, userId: string): Promise<number> {
    const knex = await getConnection(tenant);

    const result = await sessions(knex, tenant)
      .where({ user_id: userId })
      .whereNull('revoked_at')
      .where('expires_at', '>', knex.fn.now())
      .count('* as count')
      .first();

    return Number((result as any)?.count || 0);
  }

  static async updateActivity(tenant: string, sessionId: string): Promise<void> {
    const knex = await getConnection(tenant);

    await sessions(knex, tenant).where({ session_id: sessionId }).update({
      last_activity_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });
  }

  // Slides the DB session expiry to match the rolling NextAuth JWT. Never touches a revoked row.
  static async extendExpiry(tenant: string, sessionId: string, expiresAt: Date): Promise<void> {
    const knex = await getConnection(tenant);

    await sessions(knex, tenant)
      .where({ session_id: sessionId })
      .whereNull('revoked_at')
      .update({
        expires_at: expiresAt,
        updated_at: knex.fn.now(),
      });
  }

  static async updateLocation(tenant: string, sessionId: string, locationData: LocationData): Promise<void> {
    const knex = await getConnection(tenant);

    await sessions(knex, tenant).where({ session_id: sessionId }).update({
      location_data: locationData,
      updated_at: knex.fn.now(),
    });
  }

  static async revokeSession(tenant: string, sessionId: string, reason: RevocationReason): Promise<void> {
    const knex = await getConnection(tenant);

    await sessions(knex, tenant).where({ session_id: sessionId }).update({
      revoked_at: knex.fn.now(),
      revoked_reason: reason,
      updated_at: knex.fn.now(),
    });
  }

  static async revokeAllExcept(tenant: string, userId: string, keepSessionId: string): Promise<number> {
    const knex = await getConnection(tenant);

    const count = await sessions(knex, tenant)
      .where({ user_id: userId })
      .whereNot({ session_id: keepSessionId })
      .whereNull('revoked_at')
      .update({
        revoked_at: knex.fn.now(),
        revoked_reason: 'user_logout_all',
        updated_at: knex.fn.now(),
      });

    return Number(count);
  }

  static async revokeAllForUser(tenant: string, userId: string): Promise<number> {
    const knex = await getConnection(tenant);

    const count = await sessions(knex, tenant)
      .where({ user_id: userId })
      .whereNull('revoked_at')
      .update({
        revoked_at: knex.fn.now(),
        revoked_reason: 'admin_revoke',
        updated_at: knex.fn.now(),
      });

    return Number(count);
  }

  static async isRevoked(tenant: string, sessionId: string): Promise<boolean> {
    const knex = await getConnection(tenant);

    const session = await sessions(knex, tenant).where({ session_id: sessionId }).select('revoked_at').first();

    return session ? (session as any).revoked_at !== null : true;
  }

  /**
   * Validates both durable session state and the identity claims carried by the
   * JWT. A signed JWT is not sufficient authority when its user type disagrees
   * with the user that owns the tracked session.
   */
  static async isRevokedOrIdentityMismatch(
    tenant: string,
    sessionId: string,
    identity: SessionIdentity
  ): Promise<boolean> {
    const knex = await getConnection(tenant);
    const db = tenantDb(knex, tenant);
    const query = db.table<Record<string, any>>('sessions')
      .where({ 'sessions.session_id': sessionId })
      .select({
        revoked_at: 'sessions.revoked_at',
        session_user_id: 'sessions.user_id',
        actual_user_type: 'users.user_type',
      });

    db.tenantJoin(query, 'users', 'sessions.user_id', 'users.user_id', { type: 'left' });

    const session = await query.first();

    return !session
      || session.revoked_at !== null
      || session.session_user_id !== identity.userId
      || session.actual_user_type !== identity.userType;
  }

  static async enforceMaxSessions(tenant: string, userId: string, maxSessions: number): Promise<void> {
    const knex = await getConnection(tenant);

    await knex.transaction(async (trx) => {
      const activeSessions = await sessions(trx, tenant)
        .where({ user_id: userId })
        .whereNull('revoked_at')
        .where('expires_at', '>', trx.fn.now())
        .orderBy('last_activity_at', 'asc')
        .forUpdate();

      if (activeSessions.length >= maxSessions) {
        const toRevoke = activeSessions.length - maxSessions + 1;
        const sessionsToRevoke = activeSessions.slice(0, toRevoke);
        const sessionIdsToRevoke = sessionsToRevoke.map((s: any) => s.session_id);

        await sessions(trx, tenant)
          .where({ user_id: userId })
          .whereIn('session_id', sessionIdsToRevoke)
          .update({
            revoked_at: trx.fn.now(),
            revoked_reason: 'max_sessions',
            updated_at: trx.fn.now(),
          });
      }
    });
  }

  static async cleanupExpired(tenant: string): Promise<number> {
    const knex = await getConnection(tenant);

    const count = await sessions(knex, tenant)
      .where('expires_at', '<', knex.fn.now())
      .whereNull('revoked_at')
      .update({
        revoked_at: knex.fn.now(),
        revoked_reason: 'expired',
        updated_at: knex.fn.now(),
      });

    return Number(count);
  }

  static async cleanupInactive(tenant: string, inactiveDays: number = 30): Promise<number> {
    const knex = await getConnection(tenant);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - inactiveDays);

    const count = await sessions(knex, tenant)
      .where('last_activity_at', '<', cutoffDate)
      .whereNull('revoked_at')
      .update({
        revoked_at: knex.fn.now(),
        revoked_reason: 'inactivity',
        updated_at: knex.fn.now(),
      });

    return Number(count);
  }

  static async isKnownDevice(tenant: string, userId: string, deviceFingerprint: string): Promise<boolean> {
    const knex = await getConnection(tenant);

    const count = await sessions(knex, tenant)
      .where({
        user_id: userId,
        device_fingerprint: deviceFingerprint,
      })
      .whereNull('revoked_at')
      .where('expires_at', '>', knex.fn.now())
      .count('* as count')
      .first();

    return Number((count as any)?.count || 0) > 0;
  }
}
