import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { predicateGroupSchema, validatePredicate } from '@alga-psa/predicates';
import { compilePredicate } from '@alga-psa/predicates/sql';
import { audienceSchema } from './audienceSchema';

export async function getAudienceReach(knex: Knex, tenant: string, audience: unknown): Promise<{ contacts: number; clients: number }> {
  const parsed = predicateGroupSchema.safeParse(audience);
  if (!parsed.success || validatePredicate(audienceSchema, parsed.data).length) throw new Error('Invalid audience predicate');
  const db = tenantDb(knex, tenant);
  const row = await db.table('contacts as c')
    .whereExists(db.subquery('users as u').select(knex.raw('1'))
      .whereRaw('u.contact_id = c.contact_name_id').where('u.user_type', 'client').where('u.is_inactive', false))
    .whereRaw(compilePredicate(knex, audienceSchema, parsed.data, { rootAlias: 'c' }))
    .count({ contacts: '*' }).countDistinct({ clients: 'c.client_id' }).first() as { contacts: string; clients: string } | undefined;
  return { contacts: Number(row?.contacts ?? 0), clients: Number(row?.clients ?? 0) };
}
