import { Knex } from 'knex';

export type WorkflowScheduleStateStatus =
  | 'scheduled'
  | 'paused'
  | 'disabled'
  | 'completed'
  | 'failed';

export type WorkflowScheduleDayTypeFilter = 'any' | 'business' | 'non_business';

export type WorkflowScheduleStateRecord = {
  id: string;
  tenant_id: string;
  workflow_id: string;
  workflow_version: number;
  name: string;
  trigger_type: 'schedule' | 'recurring';
  day_type_filter: WorkflowScheduleDayTypeFilter;
  business_hours_schedule_id?: string | null;
  run_at?: string | null;
  cron?: string | null;
  timezone?: string | null;
  payload_json?: Record<string, unknown> | unknown[] | null;
  enabled: boolean;
  status: WorkflowScheduleStateStatus;
  job_id?: string | null;
  runner_schedule_id?: string | null;
  last_fire_at?: string | null;
  next_fire_at?: string | null;
  last_run_status?: string | null;
  last_error?: string | null;
  last_fire_key?: string | null;
  created_at: string;
  updated_at: string;
};

const serializeJsonForPgJsonColumn = (value: unknown): unknown => (
  Array.isArray(value) ? JSON.stringify(value) : value
);

const normalizeWorkflowScheduleWrite = (
  data: Partial<WorkflowScheduleStateRecord>
): Partial<WorkflowScheduleStateRecord> => {
  const out: Partial<WorkflowScheduleStateRecord> = { ...data };

  if ('payload_json' in out) {
    out.payload_json = serializeJsonForPgJsonColumn(out.payload_json) as WorkflowScheduleStateRecord['payload_json'];
  }

  return out;
};

const WorkflowScheduleStateModel = {
  create: async (
    knex: Knex,
    data: Partial<WorkflowScheduleStateRecord>
  ): Promise<WorkflowScheduleStateRecord> => {
    const normalized = normalizeWorkflowScheduleWrite(data);
    const [record] = await knex<WorkflowScheduleStateRecord>('tenant_workflow_schedule')
      .insert({
        ...normalized,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  update: async (
    knex: Knex,
    scheduleId: string,
    data: Partial<WorkflowScheduleStateRecord>
  ): Promise<WorkflowScheduleStateRecord> => {
    const normalized = normalizeWorkflowScheduleWrite(data);
    const [record] = await knex<WorkflowScheduleStateRecord>('tenant_workflow_schedule')
      .where({ id: scheduleId })
      .update({
        ...normalized,
        updated_at: new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  getById: async (knex: Knex, scheduleId: string): Promise<WorkflowScheduleStateRecord | null> => {
    const record = await knex<WorkflowScheduleStateRecord>('tenant_workflow_schedule')
      .where({ id: scheduleId })
      .first();
    return record ?? null;
  },

  getByWorkflowId: async (knex: Knex, workflowId: string): Promise<WorkflowScheduleStateRecord | null> => {
    const record = await knex<WorkflowScheduleStateRecord>('tenant_workflow_schedule')
      .where({ workflow_id: workflowId })
      .orderBy('created_at', 'asc')
      .first();
    return record ?? null;
  },

  listByWorkflowId: async (knex: Knex, workflowId: string): Promise<WorkflowScheduleStateRecord[]> =>
    knex<WorkflowScheduleStateRecord>('tenant_workflow_schedule')
      .where({ workflow_id: workflowId })
      .orderBy('created_at', 'asc'),

  listByWorkflowIds: async (knex: Knex, workflowIds: string[]): Promise<WorkflowScheduleStateRecord[]> => {
    if (!workflowIds.length) return [];
    return knex<WorkflowScheduleStateRecord>('tenant_workflow_schedule')
      .whereIn('workflow_id', workflowIds)
      .orderBy('created_at', 'asc');
  },

  listByTenantId: async (knex: Knex, tenantId: string): Promise<WorkflowScheduleStateRecord[]> =>
    knex<WorkflowScheduleStateRecord>('tenant_workflow_schedule')
      .where({ tenant_id: tenantId })
      .orderBy('created_at', 'asc'),

  list: async (knex: Knex): Promise<WorkflowScheduleStateRecord[]> =>
    knex<WorkflowScheduleStateRecord>('tenant_workflow_schedule').select('*'),

  deleteById: async (knex: Knex, scheduleId: string): Promise<number> =>
    knex<WorkflowScheduleStateRecord>('tenant_workflow_schedule')
      .where({ id: scheduleId })
      .del(),

  deleteByWorkflowId: async (knex: Knex, workflowId: string): Promise<number> =>
    knex<WorkflowScheduleStateRecord>('tenant_workflow_schedule')
      .where({ workflow_id: workflowId })
      .del()
};

export default WorkflowScheduleStateModel;
