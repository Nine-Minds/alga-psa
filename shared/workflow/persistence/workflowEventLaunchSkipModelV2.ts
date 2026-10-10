import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export type WorkflowEventLaunchSkipRecord = {
  tenant: string;
  skip_id: string;
  event_id: string;
  workflow_id: string;
  workflow_version: number | null;
  event_name: string;
  reason: string;
  intentional: boolean;
  message: string;
  details: Record<string, unknown> | null;
  created_at: string;
};

export type WorkflowEventLaunchSkipInsert = Omit<WorkflowEventLaunchSkipRecord, 'skip_id' | 'created_at'> & {
  skip_id?: string;
  created_at?: string;
};

const WorkflowEventLaunchSkipModelV2 = {
  /**
   * Inserts skips idempotently: the unique key (tenant, event_id, workflow_id)
   * makes a redelivered event a no-op instead of a double count.
   */
  insertMany: async (
    knex: Knex | Knex.Transaction,
    tenant: string,
    rows: WorkflowEventLaunchSkipInsert[]
  ): Promise<void> => {
    if (rows.length === 0) return;
    await tenantDb(knex, tenant)
      .table<WorkflowEventLaunchSkipRecord>('workflow_event_launch_skips')
      .insert(
        rows.map((row) => ({
          ...row,
          tenant,
          details: row.details === null || row.details === undefined ? null : (JSON.stringify(row.details) as any),
        })) as any
      )
      .onConflict(['tenant', 'event_id', 'workflow_id'])
      .ignore();
  },
};

export default WorkflowEventLaunchSkipModelV2;
