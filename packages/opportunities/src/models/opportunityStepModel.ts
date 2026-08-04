import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IOpportunityStep, IOpportunityStepTemplate, OpportunityStage } from '@alga-psa/types';
import { SUGGESTED_NEXT_ACTIONS } from '../lib/suggestedNextActions';

function optionalIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function normalizeStep(row: Record<string, unknown>): IOpportunityStep {
  return {
    ...row,
    has_time: Boolean(row.has_time),
    duration_minutes: Number(row.duration_minutes ?? 30),
    sort_order: Number(row.sort_order ?? 0),
    due_at: optionalIso(row.due_at),
    completed_at: optionalIso(row.completed_at),
    created_at: optionalIso(row.created_at) as string,
    updated_at: optionalIso(row.updated_at) as string,
  } as IOpportunityStep;
}

export const OpportunityStepModel = {
  async listForOpportunity(
    conn: Knex | Knex.Transaction,
    tenant: string,
    opportunityId: string,
  ): Promise<IOpportunityStep[]> {
    const db = tenantDb(conn, tenant);
    const query = db.table('opportunity_steps as s');
    db.tenantJoin(query, 'users as u', 's.assigned_to', 'u.user_id', { type: 'left' });
    db.tenantJoin(query, 'tickets as tk', 's.ticket_id', 'tk.ticket_id', { type: 'left' });
    db.tenantJoin(query, 'project_tasks as pt', 's.project_task_id', 'pt.task_id', { type: 'left' });
    const rows = await query
      .where('s.opportunity_id', opportunityId)
      .orderBy([{ column: 's.sort_order', order: 'asc' }, { column: 's.created_at', order: 'asc' }])
      .select(
        's.*',
        conn.raw("TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) as assigned_to_name"),
        'tk.ticket_number as ticket_number',
        'pt.task_name as project_task_name',
      );
    return (rows as Array<Record<string, unknown>>).map(normalizeStep);
  },

  async getById(conn: Knex | Knex.Transaction, tenant: string, stepId: string): Promise<IOpportunityStep | null> {
    const row = await tenantDb(conn, tenant).table('opportunity_steps').where({ step_id: stepId }).first();
    return row ? normalizeStep(row) : null;
  },

  async create(
    conn: Knex | Knex.Transaction,
    tenant: string,
    input: Partial<IOpportunityStep> & { opportunity_id: string; title: string },
  ): Promise<IOpportunityStep> {
    const [row] = await tenantDb(conn, tenant).table('opportunity_steps')
      .insert({ tenant, ...input })
      .returning('*');
    return normalizeStep(row);
  },

  async update(
    conn: Knex | Knex.Transaction,
    tenant: string,
    stepId: string,
    patch: Partial<IOpportunityStep>,
  ): Promise<IOpportunityStep> {
    const [row] = await tenantDb(conn, tenant).table('opportunity_steps')
      .where({ step_id: stepId })
      .update({ ...patch, updated_at: new Date().toISOString() })
      .returning('*');
    if (!row) throw new Error('Step not found');
    return normalizeStep(row);
  },

  async delete(conn: Knex | Knex.Transaction, tenant: string, stepId: string): Promise<boolean> {
    return (await tenantDb(conn, tenant).table('opportunity_steps')
      .where({ step_id: stepId })
      .whereIn('status', ['planned', 'current'])
      .delete()) > 0;
  },

  async nextSortOrder(conn: Knex | Knex.Transaction, tenant: string, opportunityId: string): Promise<number> {
    const row = await tenantDb(conn, tenant).table('opportunity_steps')
      .where({ opportunity_id: opportunityId })
      .max({ max_order: 'sort_order' })
      .first();
    return Number((row as { max_order?: number } | undefined)?.max_order ?? -1) + 1;
  },

  /**
   * Tenant templates when they exist; otherwise the stock suggestions, so a
   * tenant created after the seed migration is never left without a plan.
   */
  async listTemplates(
    conn: Knex | Knex.Transaction,
    tenant: string,
    stage?: OpportunityStage,
  ): Promise<IOpportunityStepTemplate[]> {
    const query = tenantDb(conn, tenant).table('opportunity_step_templates').where({ is_active: true });
    if (stage) query.where({ stage });
    const rows = await query.orderBy([{ column: 'stage', order: 'asc' }, { column: 'sort_order', order: 'asc' }]);
    if (rows.length > 0) return rows as IOpportunityStepTemplate[];
    return fallbackTemplates(tenant, stage);
  },
};

function fallbackTemplates(tenant: string, stage?: OpportunityStage): IOpportunityStepTemplate[] {
  const stages = (stage ? [stage] : Object.keys(SUGGESTED_NEXT_ACTIONS)) as OpportunityStage[];
  return stages.flatMap((entry) =>
    (SUGGESTED_NEXT_ACTIONS[entry] ?? []).map((suggestion, index) => ({
      tenant,
      template_id: `${entry}:${index}`,
      stage: entry as IOpportunityStepTemplate['stage'],
      title: suggestion.fallback,
      sort_order: index,
      due_offset_days: 3 + index * 2,
      is_active: true,
    })),
  );
}
