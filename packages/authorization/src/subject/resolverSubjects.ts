import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { AuthorizationSubject } from '../kernel/contracts';

/**
 * Conservative, durable membership index for row-backed resolvers. Feature rows
 * reference this index so the native tenant probe need not visit feature tables.
 * Membership is retained through revocation; the resolver's facts decide access.
 */
export function builtinResolverSubjectsQuery(
  knex: Knex | Knex.Transaction,
  tenant: string,
  resolverId: string,
): Knex.QueryBuilder {
  return tenantDb(knex, tenant).table('authorization_resolver_subjects').where('resolver_id', resolverId);
}

/** Call in the same transaction that first associates a feature row with a user. */
export async function retainBuiltinResolverSubject(
  trx: Knex.Transaction,
  subject: Pick<AuthorizationSubject, 'tenant' | 'userId'>,
  resolverId: string,
): Promise<void> {
  if (!subject.tenant || !subject.userId || !resolverId) {
    throw new Error('Resolver membership requires tenant, user and resolver identity');
  }
  await tenantDb(trx, subject.tenant).table('authorization_resolver_subjects')
    .insert({ tenant: subject.tenant, resolver_id: resolverId, user_id: subject.userId })
    .onConflict(['tenant', 'resolver_id', 'user_id']).ignore();
}
