import { badRequest, dynamic, ok, parseJsonBody, runtime } from '../_responses';
import { requireEntraAccess } from '../_guards';

export { dynamic, runtime };

export async function POST(request: Request): Promise<Response> {
  const accessGate = await requireEntraAccess('update');
  if (accessGate instanceof Response) {
    return accessGate;
  }

  const body = await parseJsonBody(request);
  const connectionType = typeof body.connectionType === 'string' ? body.connectionType : null;

  if (!connectionType || !['direct', 'cipp'].includes(connectionType)) {
    return badRequest('connectionType must be either "direct" or "cipp"');
  }

  return ok({
    status: 'connected',
    connectionType,
  });
}
