import { badRequest, dynamic, ok, runtime } from '../_responses';
import { requireEntraAccess } from '../_guards';
import { getEntraCippCredentials } from '@ee/lib/integrations/entra/providers/cipp/cippSecretStore';
import { probeCippCredentials } from '@ee/lib/integrations/entra/providers/cipp/cippProbe';
import { updateEntraConnectionValidation } from '@ee/lib/integrations/entra/connectionRepository';

export { dynamic, runtime };

export async function POST(): Promise<Response> {
  const accessGate = await requireEntraAccess('update');
  if (accessGate instanceof Response) {
    return accessGate;
  }

  const credentials = await getEntraCippCredentials(accessGate.tenantId);
  if (!credentials) {
    await updateEntraConnectionValidation({
      tenant: accessGate.tenantId,
      connectionType: 'cipp',
      status: 'validation_failed',
      snapshot: {
        message: 'CIPP credentials are not configured.',
        code: 'missing_credentials',
        checkedAt: new Date().toISOString(),
      },
    });
    return badRequest('CIPP credentials are not configured.');
  }

  const probe = await probeCippCredentials(credentials);

  if (!probe.valid) {
    await updateEntraConnectionValidation({
      tenant: accessGate.tenantId,
      connectionType: 'cipp',
      status: 'validation_failed',
      snapshot: {
        message: probe.error,
        code: probe.code,
        checkedAt: probe.checkedAt,
      },
    });
    return badRequest(probe.error);
  }

  await updateEntraConnectionValidation({
    tenant: accessGate.tenantId,
    connectionType: 'cipp',
    status: 'connected',
    snapshot: null,
  });

  return ok({
    valid: true,
    checkedAt: probe.checkedAt,
    tenantCountSample: probe.tenantCountSample,
    endpoint: probe.endpoint,
  });
}
