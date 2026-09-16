import { badRequest, dynamic, ok, runtime } from '../_responses';
import { requireEntraAccess } from '../_guards';
import { runEntraConnectionDiagnostics } from '@ee/lib/integrations/entra/diagnostics';

export { dynamic, runtime };

export async function GET(request: Request): Promise<Response> {
  const accessGate = await requireEntraAccess('read');
  if (accessGate instanceof Response) {
    return accessGate;
  }

  const includeIdentifiers =
    new URL(request.url).searchParams.get('includeIdentifiers') === 'true';

  try {
    const report = await runEntraConnectionDiagnostics(accessGate.tenantId, {
      includeIdentifiers,
    });
    return ok(report);
  } catch (error) {
    console.error('[integrations/entra/diagnostics] Connection diagnostics failed', error);
    return badRequest('Entra connection diagnostics could not be completed.');
  }
}
