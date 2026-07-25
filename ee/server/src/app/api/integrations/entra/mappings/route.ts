import { dynamic, ok, runtime } from '../_responses';
import { requireEntraAccess } from '../_guards';
import { listConfirmedEntraMappings } from '@ee/lib/integrations/entra/mapping/confirmedMappingsService';

export { dynamic, runtime };

/**
 * The confirmed mappings, named. Everything downstream of setup — the pilot
 * control, the clients list, run history that says "Contoso only" — needs
 * tenant-to-client pairs with the client's actual name, which the mapping
 * *preview* (a matching proposal) does not provide.
 */
export async function GET(): Promise<Response> {
  const accessGate = await requireEntraAccess('read');
  if (accessGate instanceof Response) {
    return accessGate;
  }

  const mappings = await listConfirmedEntraMappings(accessGate.tenantId);
  return ok({ mappings });
}
