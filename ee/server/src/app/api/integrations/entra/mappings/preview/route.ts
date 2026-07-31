import { badRequest, dynamic, ok, runtime } from '../../_responses';
import { requireEntraAccess } from '../../_guards';
import { buildEntraMappingPreview } from '@enterprise/lib/integrations/entra/mapping/mappingPreviewService';
import { entraRouteErrorMessage } from '../../_errors';

export { dynamic, runtime };

export async function GET(): Promise<Response> {
  const accessGate = await requireEntraAccess('read');
  if (accessGate instanceof Response) {
    return accessGate;
  }

  try {
    const preview = await buildEntraMappingPreview(accessGate.tenantId);
    return ok(preview);
  } catch (error: unknown) {
    const message = entraRouteErrorMessage(error, 'Failed to build Entra mapping preview.');
    return badRequest(message);
  }
}
