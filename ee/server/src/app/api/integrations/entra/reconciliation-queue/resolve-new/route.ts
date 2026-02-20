import { badRequest, dynamic, ok, runtime } from '../../_responses';
import { requireEntraUiFlagEnabled } from '../../_guards';
import { resolveEntraQueueToNewContact } from '@/lib/integrations/entra/reconciliationQueueService';

export { dynamic, runtime };

export async function POST(request: Request): Promise<Response> {
  const flagGate = await requireEntraUiFlagEnabled('update');
  if (flagGate instanceof Response) {
    return flagGate;
  }

  const body = await request.json().catch(() => null);
  const queueItemId = typeof body?.queueItemId === 'string' ? body.queueItemId.trim() : '';

  if (!queueItemId) {
    return badRequest('queueItemId is required.');
  }

  const resolved = await resolveEntraQueueToNewContact({
    tenantId: flagGate.tenantId,
    queueItemId,
    resolvedBy: flagGate.userId,
  });

  return ok(resolved);
}
