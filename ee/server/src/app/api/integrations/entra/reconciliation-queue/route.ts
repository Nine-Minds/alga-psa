import { badRequest, dynamic, ok, runtime } from '../_responses';
import { requireEntraUiFlagEnabled } from '../_guards';
import { listOpenEntraReconciliationQueue } from '@/lib/integrations/entra/reconciliationQueueService';

export { dynamic, runtime };

export async function GET(request: Request): Promise<Response> {
  const flagGate = await requireEntraUiFlagEnabled('read');
  if (flagGate instanceof Response) {
    return flagGate;
  }

  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  const parsedLimit = rawLimit ? Number(rawLimit) : 50;
  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    return badRequest('limit must be a positive number');
  }

  const items = await listOpenEntraReconciliationQueue(flagGate.tenantId, parsedLimit);
  return ok({ items });
}
