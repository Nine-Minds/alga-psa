import type { CoManagedSharedWorkContext } from './sharedWork';
import { CoManagedSharedWorkError } from './sharedWorkIdentity';
import { recordCoManagedWorkAudit } from './sharedWorkAudit';

export async function recordCoManagedProjectTaskAudit(context: CoManagedSharedWorkContext, input: {
  operation: 'co_managed_project_task_update' | 'co_managed_project_task_assignment'; operationId: string;
  changes: Record<string, unknown>; details?: Record<string, unknown>; actorReferenceId?: string | null;
}) {
  if (context.resource.kind !== 'project_task') throw new CoManagedSharedWorkError();
  return recordCoManagedWorkAudit(context, input);
}
