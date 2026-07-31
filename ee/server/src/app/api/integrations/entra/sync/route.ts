import { badRequest, dynamic, ok, parseJsonBody, runtime } from '../_responses';
import { requireEntraAccess } from '../_guards';
import {
  startEntraAllTenantsSyncWorkflow,
  startEntraInitialSyncWorkflow,
  startEntraTenantSyncWorkflow,
} from '@ee/lib/integrations/entra/entraWorkflowClient';

export { dynamic, runtime };

const SUPPORTED_SYNC_SCOPES = new Set(['initial', 'all-tenants', 'single-client']);

export async function POST(request: Request): Promise<Response> {
  const accessGate = await requireEntraAccess('update');
  if (accessGate instanceof Response) {
    return accessGate;
  }

  const body = await parseJsonBody(request);
  const scope = typeof body.scope === 'string' ? body.scope : null;

  if (!scope || !SUPPORTED_SYNC_SCOPES.has(scope)) {
    return badRequest('scope must be one of "initial", "all-tenants", or "single-client"');
  }

  const actor = { userId: accessGate.userId };

  if (scope === 'initial') {
    const result = await startEntraInitialSyncWorkflow({
      tenantId: accessGate.tenantId,
      actor,
      startImmediately: true,
    });
    return ok(
      {
        accepted: result.available,
        scope,
        runId: result.runId || null,
        workflowId: result.workflowId || null,
        error: result.error || null,
      },
      result.available ? 202 : 503,
    );
  }

  if (scope === 'all-tenants') {
    const result = await startEntraAllTenantsSyncWorkflow({
      tenantId: accessGate.tenantId,
      actor,
      trigger: 'manual',
    });
    return ok(
      {
        accepted: result.available,
        scope,
        runId: result.runId || null,
        workflowId: result.workflowId || null,
        error: result.error || null,
      },
      result.available ? 202 : 503,
    );
  }

  // single-client
  const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
  const managedTenantId = typeof body.managedTenantId === 'string' ? body.managedTenantId.trim() : '';
  if (!clientId || !managedTenantId) {
    return badRequest('single-client scope requires clientId and managedTenantId');
  }
  const result = await startEntraTenantSyncWorkflow({
    tenantId: accessGate.tenantId,
    managedTenantId,
    clientId,
    actor,
  });
  return ok(
    {
      accepted: result.available,
      scope,
      runId: result.runId || null,
      workflowId: result.workflowId || null,
      error: result.error || null,
    },
    result.available ? 202 : 503,
  );
}
