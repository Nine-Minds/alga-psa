import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { lockCoManagedActiveHomeIdentity, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired,
  CoManagedSharedWorkError, isCoManagedUuid, type CoManagedSessionActor } from './sharedWorkIdentity';

/** Authentication adapters supply these identities; business request bodies do not. */
export type CoManagedLocalAuthentication = { kind: 'session'; sessionId: string } | { kind: 'api_key'; apiKeyId: string };
export type CoManagedAuthenticatedActor = CoManagedSessionActor | { kind: 'api_key'; tenant: string; userId: string; apiKeyId: string };

/** One active home identity and its actual credential remain authoritative
 * through reads or mutations. Expiry is checked again after lock waits. */
export function snapshotCoManagedAuthenticatedActor(input: CoManagedAuthenticatedActor): CoManagedAuthenticatedActor {
  const actor = { ...input };
  if (![actor.tenant, actor.userId].every(isCoManagedUuid) || (actor.kind !== 'session' && actor.kind !== 'api_key') ||
    !isCoManagedUuid(actor.kind === 'session' ? actor.sessionId : actor.apiKeyId)) throw new CoManagedSharedWorkError();
  return actor;
}

export async function lockCoManagedLocalAuthentication(trx: Knex.Transaction, input: CoManagedAuthenticatedActor) {
  const actor = snapshotCoManagedAuthenticatedActor(input);
  if (!trx.isTransaction) throw new CoManagedSharedWorkError();
  if (actor.kind === 'session') {
    const subject = await lockCoManagedSessionIdentity(trx, actor);
    const assertCurrent = () => assertCoManagedSessionUnexpired(trx, actor);
    await assertCurrent();
    return { actor, subject, assertCurrent };
  }
  if (!isCoManagedUuid(actor.apiKeyId)) throw new CoManagedSharedWorkError();
  const subject = await lockCoManagedActiveHomeIdentity(trx, actor), owner = tenantDb(trx, actor.tenant);
  const keyQuery = () => owner.table('api_keys').where({ api_key_id: actor.apiKeyId, user_id: actor.userId, active: true })
    .where(query => query.whereNull('expires_at').orWhere('expires_at', '>', trx.raw('clock_timestamp()')));
  if (!await keyQuery().forShare().first('api_key_id')) throw new CoManagedSharedWorkError();
  subject.apiKeyId = actor.apiKeyId;
  const assertCurrent = async () => { if (!await keyQuery().first('api_key_id')) throw new CoManagedSharedWorkError(); };
  await assertCurrent();
  return { actor, subject, assertCurrent };
}
