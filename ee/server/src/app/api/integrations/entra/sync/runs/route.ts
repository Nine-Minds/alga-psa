import { badRequest, dynamic, ok, runtime } from '../../_responses';
import { requireEntraUiFlagEnabled } from '../../_guards';
import { getEntraSyncRunHistory } from '@/lib/integrations/entra/entraWorkflowClient';

export { dynamic, runtime };

export async function GET(request: Request): Promise<Response> {
  const flagGate = await requireEntraUiFlagEnabled('read');
  if (flagGate instanceof Response) {
    return flagGate;
  }

  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  const parsedLimit = rawLimit ? Number(rawLimit) : 10;
  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    return badRequest('limit must be a positive number');
  }

  const history = await getEntraSyncRunHistory(flagGate.tenantId, parsedLimit);
  return ok({ runs: history });
}
