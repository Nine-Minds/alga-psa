import { badRequest, dynamic, ok, runtime } from '../../_responses';
import { requireEntraAccess } from '../../_guards';
import { dismissEntraQueueItem } from '@ee/lib/integrations/entra/reconciliationQueueService';

export { dynamic, runtime };

export async function POST(request: Request): Promise<Response> {
  const accessGate = await requireEntraAccess('update');
  if (accessGate instanceof Response) {
    return accessGate;
  }

  const body = await request.json().catch(() => null);
  const queueItemId = typeof body?.queueItemId === 'string' ? body.queueItemId.trim() : '';
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';

  if (!queueItemId) {
    return badRequest('queueItemId is required.');
  }

  try {
    const dismissed = await dismissEntraQueueItem({
      tenantId: accessGate.tenantId,
      queueItemId,
      userId: accessGate.userId,
      reason: reason || null,
    });

    return ok(dismissed);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Queue item does not exist for this tenant.') {
      return badRequest(error.message);
    }
    throw error;
  }
}
