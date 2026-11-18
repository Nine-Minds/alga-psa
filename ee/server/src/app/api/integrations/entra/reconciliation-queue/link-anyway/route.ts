import { badRequest, dynamic, ok, runtime } from '../../_responses';
import { requireEntraAccess } from '../../_guards';
import { resolveEntraQueueLinkAnyway } from '@enterprise/lib/integrations/entra/reconciliationQueueService';

export { dynamic, runtime };

/** The operator's explicit, audited decision to link an identity to a contact at another client. */
export async function POST(request: Request): Promise<Response> {
  const accessGate = await requireEntraAccess('update');
  if (accessGate instanceof Response) {
    return accessGate;
  }

  const body = await request.json().catch(() => null);
  const queueItemId = typeof body?.queueItemId === 'string' ? body.queueItemId.trim() : '';
  const note = typeof body?.note === 'string' ? body.note.trim() : '';

  if (!queueItemId) {
    return badRequest('queueItemId is required.');
  }

  try {
    const resolved = await resolveEntraQueueLinkAnyway({
      tenantId: accessGate.tenantId,
      queueItemId,
      resolvedBy: accessGate.userId,
      note: note || null,
    });
    return ok(resolved);
  } catch (error: unknown) {
    if (error instanceof Error && /not found|already resolved|Only items queued|does not exist/.test(error.message)) {
      return badRequest(error.message);
    }
    throw error;
  }
}
