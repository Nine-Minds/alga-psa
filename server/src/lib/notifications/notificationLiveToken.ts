import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { getHocuspocusJwtSecret } from '../hocuspocusJwt';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface NotificationSessionActor { tenant: string; userId: string; sessionId: string; userType: 'internal' | 'client' }

/** The caller binds these IDs to the actual browser session, never request
 * parameters. This grants only content-free refresh signals for the user's own
 * inbox; every notification read still performs its own current authorization. */
export async function issueNotificationLiveToken(db: Knex, input: NotificationSessionActor) {
  if (!input || ![input.tenant, input.userId, input.sessionId].every(id => typeof id === 'string' && UUID.test(id)) ||
    !['internal', 'client'].includes(input.userType)) return null;
  const actor = { ...input };
  const secret = await getHocuspocusJwtSecret();
  return withTransaction(db, async trx => {
    const home = tenantDb(trx, actor.tenant);
    if (!await home.table('tenants').whereNull('suspended_at').forShare().first('tenant')) return null;
    if (!await home.table('users').where({ user_id: actor.userId, user_type: actor.userType, is_inactive: false }).forShare().first('user_id')) return null;
    const session = await home.table('sessions').where({ session_id: actor.sessionId, user_id: actor.userId })
      .whereNull('revoked_at').forShare().first('expires_at');
    if (!session) return null;
    const clock = await trx.raw('SELECT EXTRACT(EPOCH FROM clock_timestamp())::double precision AS now');
    const now = Math.floor(Number(clock.rows[0].now));
    const expires = Math.min(now + 60, Math.floor(new Date(session.expires_at).getTime() / 1000));
    if (!Number.isFinite(expires) || expires <= now) return null;
    const token = jwt.sign({ scope: 'notification-signals', tenantId: actor.tenant, userId: actor.userId,
      sessionId: actor.sessionId, iat: now, exp: expires }, secret, { algorithm: 'HS256', audience: 'notification-signals', jwtid: randomUUID() });
    return { token, expiresAt: expires * 1000, tenant: actor.tenant, userId: actor.userId };
  });
}
