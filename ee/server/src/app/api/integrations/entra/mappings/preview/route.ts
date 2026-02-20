import { badRequest, dynamic, ok, runtime } from '../../_responses';
import { requireEntraUiFlagEnabled } from '../../_guards';
import { buildEntraMappingPreview } from '@/lib/integrations/entra/mapping/mappingPreviewService';

export { dynamic, runtime };

export async function GET(): Promise<Response> {
  const flagGate = await requireEntraUiFlagEnabled('read');
  if (flagGate instanceof Response) {
    return flagGate;
  }

  try {
    const preview = await buildEntraMappingPreview(flagGate.tenantId);
    return ok(preview);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to build Entra mapping preview.';
    return badRequest(message);
  }
}
