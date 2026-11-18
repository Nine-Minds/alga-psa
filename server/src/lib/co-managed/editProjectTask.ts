import type { Knex } from 'knex';
import { ProjectTaskModel } from '@alga-psa/projects/models';
import type { CoManagedTaskWriter } from '@alga-psa/co-managed/projectTaskEditing';

/**
 * The server composes the co-managed edit flow with the base task model, so `@alga-psa/co-managed`
 * never depends on `@alga-psa/projects`. The patch has already been admitted, guarded and
 * allow-listed (task_name, project_status_mapping_id, due_date); this is the only write.
 */
export const writeCoManagedSharedTask: CoManagedTaskWriter = async (trx: Knex.Transaction, customerTenant, taskId, patch) => {
  const data: Record<string, unknown> = { ...patch };
  if (typeof data.due_date === 'string') data.due_date = new Date(data.due_date);
  await ProjectTaskModel.updateTask(trx, customerTenant, taskId, data as never);
};
