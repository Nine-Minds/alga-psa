import type { Knex } from 'knex';
import type { IProjectPhase } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import { coManagedColumnHidden, coManagedProjectFamilyMask } from '@alga-psa/co-managed/projectFieldMask';

const PHASE_FIELDS = [
  'tenant', 'phase_id', 'project_id', 'phase_name', 'description', 'start_date', 'end_date', 'completed_at',
  'status', 'order_number', 'order_key', 'created_at', 'updated_at', 'wbs_code', 'service_id',
];

function authorizedProjectPhaseQuery(trx: Knex.Transaction, tenant: string, redactedFields: string[]) {
  const mask = coManagedProjectFamilyMask(redactedFields, 'project_phase');
  if (mask.dropRow) return null;
  const hidden = new Set(PHASE_FIELDS.filter((field) => coManagedColumnHidden(redactedFields, 'project_phases', field)));
  if (mask.body) hidden.add('description');
  const query = tenantDb(trx, tenant).table('project_phases').select(...PHASE_FIELDS.map((field) => {
    if (field === 'phase_name' && mask.title) return trx.raw('?::text as ??', [mask.neutralTitle, field]);
    return hidden.has(field)
      ? trx.raw('CASE WHEN FALSE THEN ?? END as ??', [`project_phases.${field}`, field])
      : `project_phases.${field}`;
  }));
  return { query, hidden };
}

/** Load phase rows using the same field-level projection as other project reads. */
export async function loadAuthorizedProjectPhases(
  trx: Knex.Transaction,
  tenant: string,
  projectId: string,
  redactedFields: string[],
  orderBy: 'phase_id' | 'wbs_code' | 'order_key' = 'wbs_code',
): Promise<IProjectPhase[]> {
  const projection = authorizedProjectPhaseQuery(trx, tenant, redactedFields);
  if (!projection) return [];
  const { query, hidden } = projection;
  query.where({ project_id: projectId })
    .orderBy(orderBy === 'wbs_code' && hidden.has('wbs_code') ? 'phase_id' : orderBy);
  return await query as IProjectPhase[];
}

export async function loadAuthorizedProjectPhase(
  trx: Knex.Transaction,
  tenant: string,
  phaseId: string,
  redactedFields: string[],
): Promise<IProjectPhase | null> {
  const projection = authorizedProjectPhaseQuery(trx, tenant, redactedFields);
  if (!projection) return null;
  const query = projection.query.where({ phase_id: phaseId });
  return await query.first<IProjectPhase>() ?? null;
}
