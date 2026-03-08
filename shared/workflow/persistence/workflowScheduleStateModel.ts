import { Knex } from 'knex';

export type WorkflowScheduleStateStatus =
  | 'scheduled'
  | 'paused'
  | 'disabled'
  | 'completed'
  | 'failed';

export type WorkflowScheduleStateRecord = {
  id: string;
  tenant_id: string;
  workflow_id: string;
  workflow_version: number;
  trigger_type: 'schedule' | 'recurring';
  run_at?: string | null;
  cron?: string | null;
  timezone?: string | null;
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

const WorkflowScheduleStateModel = {
  create: async (
    knex: Knex,
    data: Partial<WorkflowScheduleStateRecord>
  ): Promise<WorkflowScheduleStateRecord> => {
    const [record] = await knex<WorkflowScheduleStateRecord>('tenant_workflow_schedule')
      .insert({
        ...data,
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
    const [record] = await knex<WorkflowScheduleStateRecord>('tenant_workflow_schedule')
      .where({ id: scheduleId })
      .update({
        ...data,
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
      .first();
    return record ?? null;
  },

  list: async (knex: Knex): Promise<WorkflowScheduleStateRecord[]> =>
    knex<WorkflowScheduleStateRecord>('tenant_workflow_schedule').select('*'),

  deleteByWorkflowId: async (knex: Knex, workflowId: string): Promise<number> =>
    knex<WorkflowScheduleStateRecord>('tenant_workflow_schedule')
      .where({ workflow_id: workflowId })
      .del()
};

export default WorkflowScheduleStateModel;
