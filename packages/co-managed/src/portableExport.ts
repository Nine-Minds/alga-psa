import type { Knex } from 'knex';
import type { AuthorizationSubject } from '@alga-psa/authorization';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { snapshotCoManagedSessionActor, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired,
  CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { hasCoManagedLocalPermission } from './localPermission';

/** Internal customer export boundary. Export remains available after departure
 * or a license lapse. Every delivery re-enters this boundary; provider work
 * belongs outside the transaction and never receives browser/session tokens. */
export function withCoManagedExportAdmin<T>(db: Knex, input: CoManagedSessionActor,
  work: (trx: Knex.Transaction, actor: CoManagedSessionActor, subject: AuthorizationSubject) => Promise<T>): Promise<T> {
  const actor = snapshotCoManagedSessionActor(input);
  return withTransaction(db, async trx => {
    const own = tenantDb(trx, actor.tenant);
    const owner = await own.table('tenants').forShare().first('product_code');
    if (!owner || !['co_managed', 'psa'].includes(owner.product_code) ||
        !await own.table('co_management_relationships').whereIn('state', ['active', 'terminated']).first('relationship_id')) {
      throw new CoManagedSharedWorkError();
    }
    const subject = await lockCoManagedSessionIdentity(trx, actor);
    if (!await hasCoManagedLocalPermission(trx, actor, 'co_management', 'manage', true)) throw new CoManagedSharedWorkError();
    await assertCoManagedSessionUnexpired(trx, actor);
    const result = await work(trx, actor, subject);
    await assertCoManagedSessionUnexpired(trx, actor);
    return result;
  });
}
