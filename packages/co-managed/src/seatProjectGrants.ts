import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { CoManagedSeatArrangementError } from './seatArrangement';

/**
 * Projects shared with a seat arrangement (`co_managed_seat_project_grants`).
 *
 * A seat technician sees no project until the MSP shares it. A grant is one row, `(tenant, arrangement_id,
 * project_id)`, read with the subject on every request by the seat resolver (`seatFactsQuery`), so sharing and
 * unsharing take effect on the technician's next request with nothing cached.
 *
 * Internal commands with no entry point of their own; a caller must authorize sponsor administration and access to
 * the client before using them. Like the other arrangement commands they are declarative and idempotent, take the
 * arrangement's row lock, hold no foreign keys (the table is a tenant-first ledger), and bump the arrangement's
 * revision when, and only when, the set of shared projects changed.
 */

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SetCoManagedSeatProjectSharedInput {
  sponsorTenant: string;
  arrangementId: string;
  projectId: string;
  /** True shares the project with the arrangement; false removes the grant. */
  shared: boolean;
}

export interface CoManagedSeatProjectGrantResult {
  projectId: string;
  shared: boolean;
  /** False when the request found things as asked (a repeat). */
  changed: boolean;
}

/**
 * Shares one project of the arrangement's client with the arrangement, or stops sharing it. Repeating a request
 * changes nothing. Sharing refuses a project that is not the arrangement's client's (a project of another client,
 * a missing one, or one without a client), and an arrangement that does not exist or has ended. Unsharing never
 * needs the project to exist, so a grant whose project was deleted can always be removed.
 *
 * Locks the arrangement row; it never takes the pool lock.
 */
export async function setCoManagedSeatProjectShared(
  db: Knex,
  input: SetCoManagedSeatProjectSharedInput,
): Promise<CoManagedSeatProjectGrantResult> {
  if (![input.sponsorTenant, input.arrangementId, input.projectId].every((id) => typeof id === 'string' && uuid.test(id)) ||
      typeof input.shared !== 'boolean') {
    throw new CoManagedSeatArrangementError('INVALID_PROJECT_GRANT');
  }

  return db.transaction(async (trx) => {
    const sponsor = tenantDb(trx, input.sponsorTenant);
    const arrangement = await sponsor.table('co_managed_seat_arrangements')
      .where('arrangement_id', input.arrangementId).forUpdate().first('state', 'client_id');
    if (!arrangement) throw new CoManagedSeatArrangementError('ARRANGEMENT_NOT_FOUND');
    if (arrangement.state !== 'active') throw new CoManagedSeatArrangementError('ARRANGEMENT_ENDED');

    const grant = () => sponsor.table('co_managed_seat_project_grants')
      .where({ arrangement_id: input.arrangementId, project_id: input.projectId });
    let changed: boolean;
    if (input.shared) {
      // The project must be the arrangement's client's own: a technician is limited to that client, and a grant
      // on another client's project would never be reachable through the seat rules anyway.
      const project = await sponsor.table('projects').where('project_id', input.projectId).forShare().first('client_id');
      if (!project || project.client_id !== arrangement.client_id) throw new CoManagedSeatArrangementError('PROJECT_NOT_FOUND');
      // write-admission: exempt — seat arrangement lifecycle state, written by its owning command under the arrangement lock
      const inserted = await sponsor.table('co_managed_seat_project_grants').insert({
        tenant: input.sponsorTenant, arrangement_id: input.arrangementId, project_id: input.projectId,
      }).onConflict(['tenant', 'arrangement_id', 'project_id']).ignore().returning('project_id');
      changed = inserted.length > 0;
    } else {
      // write-admission: exempt — seat arrangement lifecycle state, written by its owning command under the arrangement lock
      changed = (await grant().del()) > 0;
    }
    if (changed) {
      // write-admission: exempt — seat arrangement lifecycle state, written by its owning command under the arrangement lock
      await sponsor.table('co_managed_seat_arrangements').where('arrangement_id', input.arrangementId)
        .update({ revision: trx.raw('revision + 1'), updated_at: new Date() });
    }
    return { projectId: input.projectId, shared: input.shared, changed };
  });
}

export interface CoManagedSeatProjectOption {
  projectId: string;
  projectName: string;
  isInactive: boolean;
  shared: boolean;
}

/**
 * The arrangement's client's projects with whether each is shared: what an administrator chooses from. Empty when
 * the arrangement does not exist or has ended.
 */
export async function readCoManagedSeatProjectShares(
  db: Knex | Knex.Transaction,
  input: { sponsorTenant: string; arrangementId: string },
): Promise<CoManagedSeatProjectOption[]> {
  if (![input.sponsorTenant, input.arrangementId].every((id) => uuid.test(id))) return [];
  const sponsor = tenantDb(db, input.sponsorTenant);
  const arrangement = await sponsor.table('co_managed_seat_arrangements')
    .where({ arrangement_id: input.arrangementId, state: 'active' }).first('client_id');
  if (!arrangement) return [];
  const [projects, grants] = await Promise.all([
    sponsor.table('projects').where('client_id', arrangement.client_id).orderBy('project_name')
      .select('project_id', 'project_name', 'is_inactive'),
    sponsor.table('co_managed_seat_project_grants').where('arrangement_id', input.arrangementId).select('project_id'),
  ]);
  const shared = new Set(grants.map((row: { project_id: string }) => row.project_id));
  return projects.map((row: { project_id: string; project_name: string; is_inactive: boolean | null }) => ({
    projectId: row.project_id, projectName: row.project_name, isInactive: row.is_inactive === true, shared: shared.has(row.project_id),
  }));
}
