import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { CoManagedSharedResource } from './sharedWork';

/** Effective source disclosure only, inside an already admitted transaction.
 * Callers separately enforce active trust, identity and operation permissions. */
export async function hasEffectiveSharedGrant(trx: Knex.Transaction, resource: CoManagedSharedResource): Promise<boolean> {
  const owner = tenantDb(trx, resource.tenant);
  if (resource.kind !== 'ticket') {
    let projectId = resource.id;
    if (resource.kind === 'project_task') {
      const query = owner.table('project_tasks as task').where('task.task_id', resource.id);
      owner.tenantJoin(query, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
      projectId = (await query.forShare('task', 'phase').first('phase.project_id'))?.project_id;
      if (!projectId) return false;
    }
    return !!await owner.table('co_management_project_scopes').where({ relationship_id: resource.relationshipId, project_id: projectId }).forShare().first();
  }
  // LEVERAGE: pattern shared-work-effective-grant — customer aggregate reads and MSP source admission require the same effective ticket/board visibility.
  const work = await owner.table('co_management_ticket_work').where({ relationship_id: resource.relationshipId, ticket_id: resource.id }).forShare().first();
  if (work && !work.grant_revoked_at) return true;
  const relationship = await owner.table('co_management_relationships').where('relationship_id', resource.relationshipId).first('visibility_mode');
  if (relationship?.visibility_mode !== 'board_scope') return false;
  const ticket = await owner.table('tickets').where('ticket_id', resource.id).forShare().first('board_id');
  if (!ticket?.board_id) return false;
  return !!await owner.table('co_management_board_scopes').where({ relationship_id: resource.relationshipId, board_id: ticket?.board_id }).forShare().first();
}

