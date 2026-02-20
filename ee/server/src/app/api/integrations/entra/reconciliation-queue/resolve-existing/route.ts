import { badRequest, dynamic, ok, runtime } from '../../_responses';
import { requireEntraUiFlagEnabled } from '../../_guards';
import { resolveEntraQueueToExistingContact } from '@enterprise/lib/integrations/entra/reconciliationQueueService';

export { dynamic, runtime };

export async function POST(request: Request): Promise<Response> {
  const flagGate = await requireEntraUiFlagEnabled('update');
  if (flagGate instanceof Response) {
    return flagGate;
  }

  const body = await request.json().catch(() => null);
  const queueItemId = typeof body?.queueItemId === 'string' ? body.queueItemId.trim() : '';
  const contactNameId = typeof body?.contactNameId === 'string' ? body.contactNameId.trim() : '';

  if (!queueItemId) {
    return badRequest('queueItemId is required.');
  }
  if (!contactNameId) {
    return badRequest('contactNameId is required.');
  }

  const resolved = await resolveEntraQueueToExistingContact({
    tenantId: flagGate.tenantId,
    queueItemId,
    contactNameId,
    resolvedBy: flagGate.userId,
  });

  return ok(resolved);
}
