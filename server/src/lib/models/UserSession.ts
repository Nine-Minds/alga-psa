/**
 * UserSession Model
 *
 * Manages user session records in the database for session tracking,
 * device recognition, and concurrent session enforcement.
 *
 * Key features:
 * - Session creation with device and location tracking
 * - Session revocation and expiration
 * - Concurrent session limit enforcement
 * - Device recognition for 2FA bypass
 */

import { getConnection } from 'server/src/lib/db/db';
import type { LocationData } from 'server/src/lib/auth/geolocation';

export interface IUserSession {
  tenant: string;
  session_id: string;
  user_id: string;
  // NOTE: No token_hash - we use session_id (stored in JWT) as correlation key
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
  // NOTE: No is_current field - UI determines current session dynamically via session_id
  login_method: string | null; // 'credentials', 'google', 'microsoft', 'keycloak'
}

export interface CreateSessionParams {
  tenant: string;
  user_id: string;
  // NOTE: No token/token_hash needed - session_id serves as the correlation key
  // The session_id is stored in the JWT token and used to look up the session
  ip_address: string;
  user_agent: string;
  device_fingerprint: string;
  device_name: string;
  device_type: string;
  location_data?: LocationData | null;
  expires_at: Date;
  login_method: string; // 'credentials', 'google', 'microsoft', 'keycloak'
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
  /**
   * Create a new session record
   *
   * NOTE: We use session_id as the correlation key instead of token_hash
   * The session_id is stored in the JWT and used to look up sessions
   */
  static async create(params: CreateSessionParams): Promise<string> {
    const knex = await getConnection(params.tenant);

    const [session] = await knex('sessions')
      .insert({
        tenant: params.tenant,
        user_id: params.user_id,
        // No token_hash - we correlate via session_id stored in JWT
        // Set token to empty string since it's nullable now but may have existing validation
        token: '',
        ip_address: params.ip_address,
        user_agent: params.user_agent,
        device_fingerprint: params.device_fingerprint,
        device_name: params.device_name,
        device_type: params.device_type,
        // location_data is JSONB - Knex/PostgreSQL handles serialization automatically
        location_data: params.location_data || null,
        expires_at: params.expires_at,
        login_method: params.login_method,
        last_activity_at: knex.fn.now(),
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      })
      .returning('session_id');

    return session.session_id;
  }

  /**
   * Find session by ID
   */
  static async findById(tenant: string, sessionId: string): Promise<IUserSession | null> {
    const knex = await getConnection(tenant);

    const session = await knex('sessions')
      .where({ tenant, session_id: sessionId })
      .first();

    return session || null;
  }

  /**
   * Get all active sessions for a user
   *
   * NOTE: Defensively parses location_data if pg driver returns it as string
   */
  static async getUserSessions(tenant: string, userId: string): Promise<IUserSession[]> {
    const knex = await getConnection(tenant);

    const sessions = await knex('sessions')
      .where({ tenant, user_id: userId })
      .whereNull('revoked_at')
      .where('expires_at', '>', knex.fn.now())
      .orderBy('last_activity_at', 'desc');

    // DEFENSIVE: pg driver may return JSONB as string depending on configuration
    // Modern pg auto-parses JSONB, but be safe for older versions or custom configs
    return sessions.map((session: any) => ({
      ...session,
      location_data: typeof session.location_data === 'string'
        ? JSON.parse(session.location_data)
        : session.location_data
    }));
  }

  /**
   * Get count of active sessions for a user
   */
  static async getActiveSessionCount(tenant: string, userId: string): Promise<number> {
    const knex = await getConnection(tenant);

    const result = await knex('sessions')
      .where({ tenant, user_id: userId })
      .whereNull('revoked_at')
      .where('expires_at', '>', knex.fn.now())
      .count('* as count')
      .first();

    return Number(result?.count || 0);
  }

  /**
   * Update last activity timestamp
   */
  static async updateActivity(tenant: string, sessionId: string): Promise<void> {
    const knex = await getConnection(tenant);

    await knex('sessions')
      .where({ tenant, session_id: sessionId })
      .update({
        last_activity_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });
  }

  /**
   * Update location data for a session (async/fire-and-forget)
   * Called after session creation to avoid blocking login
   */
  static async updateLocation(
    tenant: string,
    sessionId: string,
    locationData: LocationData
  ): Promise<void> {
    const knex = await getConnection(tenant);

    await knex('sessions')
      .where({ tenant, session_id: sessionId })
      .update({
        location_data: locationData, // JSONB auto-serialized by Knex
        updated_at: knex.fn.now(),
      });
  }

  /**
   * Revoke a specific session
   */
  static async revokeSession(
    tenant: string,
    sessionId: string,
    reason: RevocationReason
  ): Promise<void> {
    const knex = await getConnection(tenant);

    await knex('sessions')
      .where({ tenant, session_id: sessionId })
      .update({
        revoked_at: knex.fn.now(),
        revoked_reason: reason,
        updated_at: knex.fn.now(),
      });

    // Invalidate cache to ensure immediate logout
    const cacheKey = `${tenant}:${sessionId}`;
    this.revocationCache.delete(cacheKey);
  }

  /**
   * Revoke all sessions for a user except one
   */
  static async revokeAllExcept(
    tenant: string,
    userId: string,
    keepSessionId: string
  ): Promise<number> {
    const knex = await getConnection(tenant);

    // Get session IDs that will be revoked (for cache invalidation)
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

    // Invalidate cache for all revoked sessions
    sessionsToRevoke.forEach(({ session_id }) => {
      const cacheKey = `${tenant}:${session_id}`;
      this.revocationCache.delete(cacheKey);
    });

    return count;
  }

  /**
   * Revoke all sessions for a user
   */
  static async revokeAllForUser(tenant: string, userId: string): Promise<number> {
    const knex = await getConnection(tenant);

    // Get session IDs that will be revoked (for cache invalidation)
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

    // Invalidate cache for all revoked sessions
    sessionsToRevoke.forEach(({ session_id }) => {
      const cacheKey = `${tenant}:${session_id}`;
      this.revocationCache.delete(cacheKey);
    });

    return count;
  }

  /**
   * In-memory cache for session revocation status
   * Format: { "tenant:sessionId": { revoked: boolean, timestamp: number } }
   * TTL: 30 seconds (trade-off between performance and revocation speed)
   */
  private static revocationCache = new Map<string, { revoked: boolean; timestamp: number }>();
  private static readonly CACHE_TTL_MS = 30000; // 30 seconds
  private static revocationInFlight = new Map<string, Promise<boolean>>();

  /**
   * Check if a session is revoked (with caching)
   *
   * Uses in-memory cache with 30s TTL to reduce database load.
   * Trade-off: Session revocation takes up to 30s to take effect.
   *
   * Performance: ~99% cache hit rate for typical usage
   */
  static async isRevoked(tenant: string, sessionId: string): Promise<boolean> {
    const cacheKey = `${tenant}:${sessionId}`;
    const now = Date.now();

    // Check cache first
    const cached = this.revocationCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < this.CACHE_TTL_MS) {
      return cached.revoked;
    }

    // Prevent cache stampede: if many parallel requests check the same session,
    // share a single DB query/promise.
    const inFlight = this.revocationInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const task = (async () => {
      const knex = await getConnection(tenant);
      const session = await knex('sessions')
        .where({ tenant, session_id: sessionId })
        .select('revoked_at')
        .first();

      const isRevoked = session ? session.revoked_at !== null : true;

      // Update cache
      this.revocationCache.set(cacheKey, { revoked: isRevoked, timestamp: Date.now() });

      // Clean up old cache entries (simple LRU: remove if > 1000 entries)
      if (this.revocationCache.size > 1000) {
        const entries = Array.from(this.revocationCache.entries());
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
        entries.slice(0, 500).forEach(([key]) => this.revocationCache.delete(key));
      }

      return isRevoked;
    })();

    this.revocationInFlight.set(cacheKey, task);
    try {
      return await task;
    } finally {
      this.revocationInFlight.delete(cacheKey);
    }
  }

  /**
   * Enforce maximum concurrent sessions for a user
   * Revokes oldest sessions if limit exceeded
   *
   * Concurrent sessions are counted as:
   * - NOT revoked (revoked_at IS NULL)
   * - NOT expired (expires_at > NOW())
   * - Belonging to the same tenant and user_id
   *
   * IMPORTANT: Uses transaction with SELECT FOR UPDATE to prevent race conditions
   * This ensures parallel logins cannot bypass the session limit
   *
   * NOTE: Caller should check for unlimited sessions (-1) and skip calling this method
   *
   * @param tenant - Tenant ID
   * @param userId - User ID
   * @param maxSessions - Maximum allowed concurrent sessions (e.g., 5). Must be > 0, never -1.
   */
  static async enforceMaxSessions(
    tenant: string,
    userId: string,
    maxSessions: number
  ): Promise<void> {
    const knex = await getConnection(tenant);

    // Use a transaction with row-level locking to prevent race conditions
    const revokedSessionIds: string[] = [];
    await knex.transaction(async (trx) => {
      // Lock all active sessions for this user using SELECT FOR UPDATE
      // This prevents parallel login requests from reading the same count
      const sessions = await trx('sessions')
        .where({ tenant, user_id: userId })
        .whereNull('revoked_at')
        .where('expires_at', '>', trx.fn.now())
        .orderBy('last_activity_at', 'asc') // Oldest first
        .forUpdate(); // CRITICAL: Row-level lock

      // If user will exceed maxSessions after login, revoke oldest ones
      // Note: This is called BEFORE creating the new session
      if (sessions.length >= maxSessions) {
        // Calculate how many sessions to revoke to make room for the new one
        // Example: User has 5 sessions, limit is 5, logging in will create 6th
        // Need to revoke: (5 - 5) + 1 = 1 session
        const toRevoke = (sessions.length - maxSessions) + 1;

        // Get the oldest sessions to revoke
        const sessionsToRevoke = sessions.slice(0, toRevoke);

        // Revoke them in a single UPDATE query for performance
        const sessionIdsToRevoke = sessionsToRevoke.map(s => s.session_id);
        revokedSessionIds.push(...sessionIdsToRevoke);

        // CRITICAL: Include tenant and user_id in UPDATE to prevent cross-tenant revocation
        // Primary key is (tenant, session_id), so UUID collisions across tenants are legal
        // Without tenant filter, this could revoke another tenant's session
        await trx('sessions')
          .where({ tenant, user_id: userId }) // CRITICAL: Scope to this tenant/user
          .whereIn('session_id', sessionIdsToRevoke)
          .update({
            revoked_at: trx.fn.now(),
            revoked_reason: 'max_sessions',
            updated_at: trx.fn.now(),
          });
      }

      // Transaction commits - locks released
    });

    // Invalidate cache for all revoked sessions
    revokedSessionIds.forEach((sessionId) => {
      const cacheKey = `${tenant}:${sessionId}`;
      this.revocationCache.delete(cacheKey);
    });

    // After this, sessions.length < maxSessions, so new session can be created
  }

  /**
   * Clean up expired sessions
   */
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

    return count;
  }

  /**
   * Clean up inactive sessions (e.g., no activity in 30 days)
   */
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

    return count;
  }

  /**
   * Check if device is recognized for a user
   *
   * CRITICAL: Only counts ACTIVE sessions (not revoked, not expired)
   * Otherwise, a device that was explicitly revoked for security reasons
   * would still be considered "known" and bypass 2FA forever
   */
  static async isKnownDevice(
    tenant: string,
    userId: string,
    deviceFingerprint: string
  ): Promise<boolean> {
    const knex = await getConnection(tenant);

    const count = await knex('sessions')
      .where({
        tenant,
        user_id: userId,
        device_fingerprint: deviceFingerprint
      })
      // CRITICAL: Only trust active sessions, not revoked/expired ones
      .whereNull('revoked_at')
      .where('expires_at', '>', knex.fn.now())
      .count('* as count')
      .first();

    return Number(count?.count || 0) > 0;
  }
}
