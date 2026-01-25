/**
 * UserSession Model
 *
 * Manages user session records in the database for session tracking,
 * device recognition, and concurrent session enforcement.
 */

import { getConnection } from '../lib/tenant';

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

export type RevocationReason =
  | 'user_logout'
  | 'user_logout_all'
  | 'admin_revoke'
  | 'max_sessions'
  | 'security'
  | 'inactivity'
  | 'expired';

export class UserSession {
  static async create(params: CreateSessionParams): Promise<string> {
    const knex = await getConnection(params.tenant);

    const [session] = await knex('sessions')
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

    const session = await knex('sessions').where({ tenant, session_id: sessionId }).first();

    return session || null;
  }

  static async getUserSessions(tenant: string, userId: string): Promise<IUserSession[]> {
    const knex = await getConnection(tenant);

    const sessions = await knex('sessions')
      .where({ tenant, user_id: userId })
      .whereNull('revoked_at')
      .where('expires_at', '>', knex.fn.now())
      .orderBy('last_activity_at', 'desc');

    return sessions.map((session: any) => ({
      ...session,
      location_data: typeof session.location_data === 'string' ? JSON.parse(session.location_data) : session.location_data,
    }));
  }

  static async getActiveSessionCount(tenant: string, userId: string): Promise<number> {
    const knex = await getConnection(tenant);

    const result = await knex('sessions')
      .where({ tenant, user_id: userId })
      .whereNull('revoked_at')
      .where('expires_at', '>', knex.fn.now())
      .count('* as count')
      .first();

    return Number((result as any)?.count || 0);
  }

  static async updateActivity(tenant: string, sessionId: string): Promise<void> {
    const knex = await getConnection(tenant);

    await knex('sessions').where({ tenant, session_id: sessionId }).update({
      last_activity_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });
  }

  static async updateLocation(tenant: string, sessionId: string, locationData: LocationData): Promise<void> {
    const knex = await getConnection(tenant);

    await knex('sessions').where({ tenant, session_id: sessionId }).update({
      location_data: locationData,
      updated_at: knex.fn.now(),
    });
  }

  static async revokeSession(tenant: string, sessionId: string, reason: RevocationReason): Promise<void> {
    const knex = await getConnection(tenant);

    await knex('sessions').where({ tenant, session_id: sessionId }).update({
      revoked_at: knex.fn.now(),
      revoked_reason: reason,
      updated_at: knex.fn.now(),
    });

    const cacheKey = `${tenant}:${sessionId}`;
    this.revocationCache.delete(cacheKey);
  }

  static async revokeAllExcept(tenant: string, userId: string, keepSessionId: string): Promise<number> {
    const knex = await getConnection(tenant);

    const sessionsToRevoke = await knex('sessions')
      .where({ tenant, user_id: userId })
      .whereNot({ session_id: keepSessionId })
      .whereNull('revoked_at')
      .select('session_id');

    const count = await knex('sessions')
      .where({ tenant, user_id: userId })
      .whereNot({ session_id: keepSessionId })
      .whereNull('revoked_at')
      .update({
        revoked_at: knex.fn.now(),
        revoked_reason: 'user_logout_all',
        updated_at: knex.fn.now(),
      });

    sessionsToRevoke.forEach(({ session_id }: any) => {
      const cacheKey = `${tenant}:${session_id}`;
      this.revocationCache.delete(cacheKey);
    });

    return Number(count);
  }

  static async revokeAllForUser(tenant: string, userId: string): Promise<number> {
    const knex = await getConnection(tenant);

    const sessionsToRevoke = await knex('sessions')
      .where({ tenant, user_id: userId })
      .whereNull('revoked_at')
      .select('session_id');

    const count = await knex('sessions')
      .where({ tenant, user_id: userId })
      .whereNull('revoked_at')
      .update({
        revoked_at: knex.fn.now(),
        revoked_reason: 'admin_revoke',
        updated_at: knex.fn.now(),
      });

    sessionsToRevoke.forEach(({ session_id }: any) => {
      const cacheKey = `${tenant}:${session_id}`;
      this.revocationCache.delete(cacheKey);
    });

    return Number(count);
  }

  private static revocationCache = new Map<string, { revoked: boolean; timestamp: number }>();
  private static readonly CACHE_TTL_MS = 30000;

  static async isRevoked(tenant: string, sessionId: string): Promise<boolean> {
    const cacheKey = `${tenant}:${sessionId}`;
    const now = Date.now();

    const cached = this.revocationCache.get(cacheKey);
    if (cached && now - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.revoked;
    }

    const knex = await getConnection(tenant);

    const session = await knex('sessions').where({ tenant, session_id: sessionId }).select('revoked_at').first();

    const isRevoked = session ? (session as any).revoked_at !== null : true;

    this.revocationCache.set(cacheKey, { revoked: isRevoked, timestamp: now });

    if (this.revocationCache.size > 1000) {
      const entries = Array.from(this.revocationCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      entries.slice(0, 500).forEach(([key]) => this.revocationCache.delete(key));
    }

    return isRevoked;
  }

  static async enforceMaxSessions(tenant: string, userId: string, maxSessions: number): Promise<void> {
    const knex = await getConnection(tenant);

    const revokedSessionIds: string[] = [];
    await knex.transaction(async (trx) => {
      const sessions = await trx('sessions')
        .where({ tenant, user_id: userId })
        .whereNull('revoked_at')
        .where('expires_at', '>', trx.fn.now())
        .orderBy('last_activity_at', 'asc')
        .forUpdate();

      if (sessions.length >= maxSessions) {
        const toRevoke = sessions.length - maxSessions + 1;
        const sessionsToRevoke = sessions.slice(0, toRevoke);
        const sessionIdsToRevoke = sessionsToRevoke.map((s: any) => s.session_id);
        revokedSessionIds.push(...sessionIdsToRevoke);

        await trx('sessions')
          .where({ tenant, user_id: userId })
          .whereIn('session_id', sessionIdsToRevoke)
          .update({
            revoked_at: trx.fn.now(),
            revoked_reason: 'max_sessions',
            updated_at: trx.fn.now(),
          });
      }
    });

    revokedSessionIds.forEach((sessionId) => {
      const cacheKey = `${tenant}:${sessionId}`;
      this.revocationCache.delete(cacheKey);
    });
  }

  static async cleanupExpired(tenant: string): Promise<number> {
    const knex = await getConnection(tenant);

    const count = await knex('sessions')
      .where({ tenant })
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

    const count = await knex('sessions')
      .where({ tenant })
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

    const count = await knex('sessions')
      .where({
        tenant,
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
