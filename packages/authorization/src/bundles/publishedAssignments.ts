import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Every assignment that can currently narrow someone: active assignment of an
 * active bundle that has a published revision. This is the single definition of
 * "published" for evaluation; per-subject targeting and the tenant fast-path
 * probe both build on it, so they cannot disagree.
 */
export function publishedAssignmentsQuery(knex: Knex | Knex.Transaction, tenant: string): Knex.QueryBuilder {
  const db = tenantDb(knex, tenant);
  const query = db.table('authorization_bundle_assignments as a');
  db.tenantJoin(query, 'authorization_bundles as b', 'b.bundle_id', 'a.bundle_id');
  return query.where('a.status', 'active').where('b.status', 'active').whereNotNull('b.published_revision_id');
}
