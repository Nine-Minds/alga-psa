import { badRequest, dynamic, ok, parseJsonBody, runtime } from '../../_responses';
import { requireEntraAccess } from '../../_guards';
import { runEntraClientAccessDiagnostics } from '@ee/lib/integrations/entra/diagnostics';

export { dynamic, runtime };

export async function POST(request: Request): Promise<Response> {
  const accessGate = await requireEntraAccess('read');
  if (accessGate instanceof Response) {
    return accessGate;
  }

  const body = await parseJsonBody(request);
  const rawClientIds = body.clientIds;
  let clientIds: string[] | undefined;
  if (rawClientIds === undefined) {
    clientIds = undefined;
  } else if (Array.isArray(rawClientIds) && rawClientIds.every((v) => typeof v === 'string')) {
    clientIds = rawClientIds as string[];
  } else {
    return badRequest('clientIds must be an array of client ids.');
  }

  const includeUserYield = body.includeUserYield === true;
  const continuation = typeof body.continuation === 'string' ? body.continuation : undefined;

  try {
    const result = await runEntraClientAccessDiagnostics(accessGate.tenantId, accessGate.userId, {
      clientIds,
      includeUserYield,
      continuation,
    });
    return ok(result);
  } catch (error) {
    console.error('[integrations/entra/diagnostics/clients] Client diagnostics failed', error);
    return badRequest('Entra client access diagnostics could not be completed.');
  }
}
