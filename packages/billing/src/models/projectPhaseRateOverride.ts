import { tenantDb } from '@alga-psa/db';
import type { IProjectPhaseRateOverride } from '@alga-psa/types';
import {
  normalizeProjectPhaseRateOverride,
  resolveProjectBillingDb,
  withoutUndefined,
  type ProjectBillingDbConnection
} from './projectBillingModelUtils';

export interface CreateProjectPhaseRateOverrideModelInput {
  phase_id: string;
  service_id?: string | null;
  rate?: number | null;
  override_service_id?: string | null;
}

export type UpdateProjectPhaseRateOverrideModelInput = Partial<Omit<
  IProjectPhaseRateOverride,
  'tenant' | 'rate_override_id' | 'phase_id' | 'created_at' | 'updated_at'
>>;

const ProjectPhaseRateOverride = {
  getById: async (
    overrideId: string,
    trx?: ProjectBillingDbConnection
  ): Promise<IProjectPhaseRateOverride | null> => {
    const { connection, tenant } = await resolveProjectBillingDb(trx);
    const row = await tenantDb(connection, tenant).table('project_phase_rate_overrides')
      .where({ rate_override_id: overrideId })
      .first();

    return row ? normalizeProjectPhaseRateOverride(row as Record<string, unknown>) : null;
  },

  insert: async (
    input: CreateProjectPhaseRateOverrideModelInput,
    trx?: ProjectBillingDbConnection
  ): Promise<IProjectPhaseRateOverride> => {
    const { connection, tenant } = await resolveProjectBillingDb(trx);
    const {
      tenant: _tenant,
      rate_override_id: _overrideId,
      created_at: _createdAt,
      updated_at: _updatedAt,
      ...safeInput
    } = input as CreateProjectPhaseRateOverrideModelInput & Partial<IProjectPhaseRateOverride>;
    const [row] = await tenantDb(connection, tenant).table('project_phase_rate_overrides')
      .insert(withoutUndefined({ ...safeInput, tenant }))
      .returning('*');

    if (!row) {
      throw new Error('Failed to insert project phase rate override');
    }
    return normalizeProjectPhaseRateOverride(row as Record<string, unknown>);
  },

  update: async (
    overrideId: string,
    updates: UpdateProjectPhaseRateOverrideModelInput,
    trx?: ProjectBillingDbConnection
  ): Promise<IProjectPhaseRateOverride | null> => {
    const { connection, tenant } = await resolveProjectBillingDb(trx);
    const {
      tenant: _tenant,
      rate_override_id: _overrideId,
      phase_id: _phaseId,
      created_at: _createdAt,
      updated_at: _updatedAt,
      ...mutableUpdates
    } = updates as Partial<IProjectPhaseRateOverride>;
    const [row] = await tenantDb(connection, tenant).table('project_phase_rate_overrides')
      .where({ rate_override_id: overrideId })
      .update({
        ...withoutUndefined(mutableUpdates),
        updated_at: new Date().toISOString()
      })
      .returning('*');

    return row ? normalizeProjectPhaseRateOverride(row as Record<string, unknown>) : null;
  },

  delete: async (
    overrideId: string,
    trx?: ProjectBillingDbConnection
  ): Promise<boolean> => {
    const { connection, tenant } = await resolveProjectBillingDb(trx);
    const deleted = await tenantDb(connection, tenant).table('project_phase_rate_overrides')
      .where({ rate_override_id: overrideId })
      .delete();
    return deleted > 0;
  },

  listByProject: async (
    projectId: string,
    trx?: ProjectBillingDbConnection
  ): Promise<IProjectPhaseRateOverride[]> => {
    const { connection, tenant } = await resolveProjectBillingDb(trx);
    const db = tenantDb(connection, tenant);
    const query = db.table('project_phase_rate_overrides as rate_override')
      .where('phase.project_id', projectId)
      .select('rate_override.*')
      .orderBy('phase.order_number', 'asc')
      .orderBy('rate_override.created_at', 'asc')
      .orderBy('rate_override.rate_override_id', 'asc');
    db.tenantJoin(
      query,
      'project_phases as phase',
      'rate_override.phase_id',
      'phase.phase_id'
    );

    const rows = await query;
    return rows.map((row) => normalizeProjectPhaseRateOverride(row as Record<string, unknown>));
  }
};

export default ProjectPhaseRateOverride;
