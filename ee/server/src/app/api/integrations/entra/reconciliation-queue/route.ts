import { badRequest, dynamic, ok, runtime } from '../_responses';
import { requireEntraAccess } from '../_guards';
import { listOpenEntraReconciliationQueue } from '@enterprise/lib/integrations/entra/reconciliationQueueService';

export { dynamic, runtime };

export async function GET(request: Request): Promise<Response> {
  const accessGate = await requireEntraAccess('read');
  if (accessGate instanceof Response) {
    return accessGate;
  }

  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  const parsedLimit = rawLimit ? Number(rawLimit) : 50;
  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    return badRequest('limit must be a positive number');
  }

  const items = await listOpenEntraReconciliationQueue(accessGate.tenantId, parsedLimit);
  return ok({ items });
}
