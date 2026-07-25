import { badRequest, dynamic, ok, runtime } from '../../_responses';
import { requireEntraAccess } from '../../_guards';
import { getEntraSyncRunHistory } from '@enterprise/lib/integrations/entra/entraWorkflowClient';

export { dynamic, runtime };

export async function GET(request: Request): Promise<Response> {
  const accessGate = await requireEntraAccess('read');
  if (accessGate instanceof Response) {
    return accessGate;
  }

  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  const parsedLimit = rawLimit ? Number(rawLimit) : 10;
  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    return badRequest('limit must be a positive number');
  }

  const history = await getEntraSyncRunHistory(accessGate.tenantId, parsedLimit);
  return ok({ runs: history });
}
