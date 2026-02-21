import { badRequest, dynamic, ok, parseJsonBody, runtime } from '../_responses';
import { requireEntraUiFlagEnabled } from '../_guards';

export { dynamic, runtime };

const SUPPORTED_SYNC_SCOPES = new Set(['initial', 'all-tenants', 'single-client']);

export async function POST(request: Request): Promise<Response> {
  const flagGate = await requireEntraUiFlagEnabled('update');
  if (flagGate instanceof Response) {
    return flagGate;
  }

  const body = await parseJsonBody(request);
  const scope = typeof body.scope === 'string' ? body.scope : null;

  if (!scope || !SUPPORTED_SYNC_SCOPES.has(scope)) {
    return badRequest('scope must be one of "initial", "all-tenants", or "single-client"');
  }

  return ok(
    {
      accepted: true,
      scope,
      runId: null,
    },
    202
  );
}
