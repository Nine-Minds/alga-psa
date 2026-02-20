import { badRequest, dynamic, ok, runtime } from '../../../_responses';
import { requireEntraUiFlagEnabled } from '../../../_guards';
import { getEntraSyncRunProgress } from '@/lib/integrations/entra/entraWorkflowClient';
import { serializeEntraSyncRunProgress } from '@/lib/integrations/entra/sync/syncResultSerializer';

export { dynamic, runtime };

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> }
): Promise<Response> {
  const flagGate = await requireEntraUiFlagEnabled('read');
  if (flagGate instanceof Response) {
    return flagGate;
  }

  const { runId } = await context.params;
  if (!runId) {
    return badRequest('runId is required.');
  }

  const result = await getEntraSyncRunProgress(flagGate.tenantId, runId);
  if (!result.run) {
    return badRequest('Sync run not found.');
  }

  return ok(serializeEntraSyncRunProgress(result));
}
