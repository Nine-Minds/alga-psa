import { badRequest, dynamic, ok, parseJsonBody, runtime } from '../../_responses';
import { requireEntraUiFlagEnabled } from '../../_guards';

export { dynamic, runtime };

export async function POST(request: Request): Promise<Response> {
  const flagGate = await requireEntraUiFlagEnabled();
  if (flagGate instanceof Response) {
    return flagGate;
  }

  const body = await parseJsonBody(request);
  const mappings = Array.isArray(body.mappings) ? body.mappings : null;

  if (!mappings) {
    return badRequest('mappings must be an array');
  }

  return ok({
    confirmedMappings: mappings.length,
  });
}
