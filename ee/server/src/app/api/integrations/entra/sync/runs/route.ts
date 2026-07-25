import { badRequest, dynamic, ok, runtime } from '../../_responses';
import { requireEntraAccess } from '../../_guards';
import {
  getEntraSyncRunHistory,
  getEntraSyncRunProgress,
} from '@enterprise/lib/integrations/entra/entraWorkflowClient';
import { serializeEntraSyncRunProgress } from '@enterprise/lib/integrations/entra/sync/syncResultSerializer';

export { dynamic, runtime };

export async function GET(request: Request): Promise<Response> {
  const accessGate = await requireEntraAccess('read');
  if (accessGate instanceof Response) {
    return accessGate;
  }

  const url = new URL(request.url);

  // One run, with its per-client results. The [runId] route says the same thing
  // as a path segment, but a server action can only reach a route handler that
  // takes the request alone — no dynamic params — so the detail is available
  // here as a query too.
  const runId = url.searchParams.get('runId');
  if (runId) {
    const progress = await getEntraSyncRunProgress(accessGate.tenantId, runId);
    if (!progress.run) {
      return badRequest('Sync run not found.');
    }
    return ok(serializeEntraSyncRunProgress(progress));
  }

  const rawLimit = url.searchParams.get('limit');
  const parsedLimit = rawLimit ? Number(rawLimit) : 10;
  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    return badRequest('limit must be a positive number');
  }

  const history = await getEntraSyncRunHistory(accessGate.tenantId, parsedLimit);
  return ok({ runs: history });
}
