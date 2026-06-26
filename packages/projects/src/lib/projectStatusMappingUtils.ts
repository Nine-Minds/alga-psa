import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IProjectStatusMapping } from '@alga-psa/types';

export type ProjectStatusMappingDetails = IProjectStatusMapping & {
  status_name: string;
  name: string;
  is_closed: boolean;
};

export async function getScopedProjectStatusMappings(
  trx: Knex.Transaction,
  tenant: string,
  projectId: string,
  phaseId?: string | null
): Promise<ProjectStatusMappingDetails[]> {
  const db = tenantDb(trx, tenant);
  const query = db
    .table('project_status_mappings as psm')
    .leftJoin('standard_statuses as ss', function joinStandardStatuses(this: Knex.JoinClause) {
      this.on('psm.standard_status_id', '=', 'ss.standard_status_id');
    })
    .where({ 'psm.project_id': projectId })
    .select(
      'psm.*',
      trx.raw('COALESCE(psm.custom_name, s.name, ss.name, psm.project_status_mapping_id::text) as status_name'),
      trx.raw('COALESCE(psm.custom_name, s.name, ss.name, psm.project_status_mapping_id::text) as name'),
      trx.raw('COALESCE(s.is_closed, ss.is_closed, false) as is_closed')
    );
  db.tenantJoin(query, 'statuses as s', 'psm.status_id', 's.status_id', { type: 'left' });

  if (phaseId) {
    query.andWhere('psm.phase_id', phaseId);
  } else {
    query.whereNull('psm.phase_id');
  }

  return query.orderBy('psm.display_order');
}
