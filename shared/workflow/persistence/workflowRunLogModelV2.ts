import { Knex } from 'knex';

export type WorkflowRunLogRecord = {
  log_id: string;
  run_id: string;
  tenant_id?: string | null;
  step_id?: string | null;
  step_path?: string | null;
  level: string;
  message: string;
  context_json?: Record<string, unknown> | null;
  correlation_key?: string | null;
  event_name?: string | null;
  source?: string | null;
  created_at: string;
};

export type WorkflowRunLogFilters = {
  level?: string[];
  search?: string;
  limit?: number;
  cursor?: number;
};

const WorkflowRunLogModelV2 = {
  create: async (knex: Knex, data: Partial<WorkflowRunLogRecord>): Promise<WorkflowRunLogRecord> => {
    const [record] = await knex<WorkflowRunLogRecord>('workflow_run_logs')
      .insert({
        ...data,
        created_at: data.created_at ?? new Date().toISOString()
      })
      .returning('*');
    return record;
  },

  listByRun: async (
    knex: Knex,
    runId: string,
    filters: WorkflowRunLogFilters = {}
  ): Promise<{ logs: WorkflowRunLogRecord[]; nextCursor: number | null }> => {
    const limit = filters.limit ?? 100;
    const cursor = filters.cursor ?? 0;

    const query = knex<WorkflowRunLogRecord>('workflow_run_logs')
      .where({ run_id: runId });

    if (filters.level?.length) {
      query.whereIn('level', filters.level);
    }
    if (filters.search) {
      const searchValue = `%${filters.search}%`;
      query.andWhere((builder) => {
        builder
          .where('message', 'ilike', searchValue)
          .orWhereRaw('context_json::text ilike ?', [searchValue]);
      });
    }

    const rows = await query
      .orderBy('created_at', 'desc')
      .orderBy('log_id', 'desc')
      .limit(limit + 1)
      .offset(cursor);

    const hasMore = rows.length > limit;
    const logs = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? cursor + limit : null;

    return { logs, nextCursor };
  }
};

export default WorkflowRunLogModelV2;
