import { badRequest, dynamic, ok, parseJsonBody, runtime } from '../../_responses';
import { requireEntraAccess } from '../../_guards';
import { runEntraPreflight } from '@ee/lib/integrations/entra/sync/preflightService';
import { entraRouteErrorMessage } from '../../_errors';

export { dynamic, runtime };

export async function POST(request: Request): Promise<Response> {
  // A preflight reads the directory and writes only its own audit row, but it
  // is still an operator action against the integration, so it takes the same
  // update gate as running a sync.
  const accessGate = await requireEntraAccess('update');
  if (accessGate instanceof Response) {
    return accessGate;
  }

  const body = await parseJsonBody(request);
  const managedTenantId = typeof body.managedTenantId === 'string' ? body.managedTenantId.trim() : '';
  const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';

  if (!managedTenantId && !clientId) {
    return badRequest('preflight requires managedTenantId or clientId');
  }

  const sampleLimit =
    typeof body.sampleLimit === 'number' && Number.isFinite(body.sampleLimit)
      ? Math.min(Math.max(Math.trunc(body.sampleLimit), 1), 100)
      : undefined;

  try {
    const result = await runEntraPreflight({
      tenantId: accessGate.tenantId,
      managedTenantId: managedTenantId || null,
      clientId: clientId || null,
      userId: accessGate.userId,
      sampleLimit,
    });

    return ok(result);
  } catch (error: unknown) {
    const rawMessage = error instanceof Error ? error.message : '';
    if (rawMessage === 'No confirmed mapping matches the requested preflight scope.') {
      return badRequest(rawMessage);
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: entraRouteErrorMessage(error, 'Entra preflight failed.'),
      }),
      {
        status: 502,
        headers: { 'content-type': 'application/json' },
      }
    );
  }
}
