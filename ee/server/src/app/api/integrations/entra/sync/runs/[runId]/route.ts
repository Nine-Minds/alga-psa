import { badRequest, dynamic, ok, runtime } from '../../../_responses';
import { requireEntraAccess } from '../../../_guards';
import { getEntraSyncRunProgress } from '@enterprise/lib/integrations/entra/entraWorkflowClient';
import { serializeEntraSyncRunProgress } from '@enterprise/lib/integrations/entra/sync/syncResultSerializer';

export { dynamic, runtime };

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> }
): Promise<Response> {
  const accessGate = await requireEntraAccess('read');
  if (accessGate instanceof Response) {
    return accessGate;
  }

  const { runId } = await context.params;
  if (!runId) {
    return badRequest('runId is required.');
  }

  const result = await getEntraSyncRunProgress(accessGate.tenantId, runId);
  if (!result.run) {
    return badRequest('Sync run not found.');
  }

  return ok(serializeEntraSyncRunProgress(result));
}
