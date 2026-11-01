import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { CoManagedPolicyTarget } from './policy';

/**
 * L8b's read-only check that a customer who ALREADY DEPARTED left through a sealed L7a closure, so an
 * independent upgrade can rely on it without closing anything again. Written against L7a's schema
 * (`origin/feature/cm-l7a-departure-closure-licence-lapse`), all on the sponsor tenant:
 *  - `co_managed_relationship_closures`: one row per (tenant, relationship_id), `closed_at` equal to the
 *    relationship's `ended_at`, `applied_revision` equal to its current revision;
 *  - `co_managed_archive_manifests`: one sealed manifest for the same `operation_id` and `cutoff_at`;
 *  - `co_managed_allocations`: nothing left with `released_at IS NULL` for the relationship.
 * It never re-derives the manifest hash (that function is L7a's, `coManagedArchiveManifestHash`); the
 * wiring adds that check when L7a is on main. Any missing table or mismatch throws: verify, never redo.
 */
export class CoManagedDepartedClosureError extends Error {
  constructor(reason: string) { super(`Departed closure is not sealed: ${reason}`); this.name = 'CoManagedDepartedClosureError'; }
}

const at = (value: Date | string | null | undefined) => (value === null || value === undefined ? NaN : new Date(value).getTime());

export async function verifyCoManagedDepartedClosure(trx: Knex.Transaction, target: CoManagedPolicyTarget,
  relationship: { revision: number; ended_at: Date | string | null; sponsor_tenant: string }): Promise<{ operationId: string }> {
  const fail = (reason: string): never => { throw new CoManagedDepartedClosureError(reason); };
  for (const table of ['co_managed_relationship_closures', 'co_managed_archive_manifests', 'co_managed_allocations']) {
    if (!await trx.schema.hasTable(table)) fail(`${table} is not available`);
  }
  const endedAt = at(relationship.ended_at);
  if (!Number.isFinite(endedAt)) fail('relationship has no end');
  const sponsor = tenantDb(trx, relationship.sponsor_tenant);
  const closure = await sponsor.table('co_managed_relationship_closures')
    .where({ customer_tenant: target.customerTenant, relationship_id: target.relationshipId }).forShare()
    .first('operation_id', 'applied_revision', 'cutoff_at', 'closed_at');
  if (!closure) fail('no closure receipt');
  if (at(closure.closed_at) !== endedAt) fail('closure time differs from the relationship end');
  if (Number(closure.applied_revision) !== Number(relationship.revision)) fail('relationship changed after closure');
  const manifest = await sponsor.table('co_managed_archive_manifests')
    .where({ operation_id: closure.operation_id, customer_tenant: target.customerTenant, relationship_id: target.relationshipId }).forShare()
    .first('cutoff_at', 'content_hash');
  if (!manifest) fail('no sealed archive manifest');
  if (at(manifest.cutoff_at) !== at(closure.cutoff_at)) fail('archive cutoff differs from the closure cutoff');
  if (typeof manifest.content_hash !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.content_hash)) fail('archive manifest hash is malformed');
  if (await sponsor.table('co_managed_allocations')
    .where({ customer_tenant: target.customerTenant, relationship_id: target.relationshipId }).whereNull('released_at').first('relationship_id')) {
    fail('allocation was not released');
  }
  return { operationId: closure.operation_id as string };
}
