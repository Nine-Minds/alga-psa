import { dynamic, ok, runtime } from '../_responses';
import { requireEntraAccess } from '../_guards';
import { clearEntraDirectTokenSet } from '@enterprise/lib/integrations/entra/auth/tokenStore';
import { clearEntraCippCredentials } from '@enterprise/lib/integrations/entra/providers/cipp/cippSecretStore';
import { disconnectActiveEntraConnection } from '@enterprise/lib/integrations/entra/connectionRepository';

export { dynamic, runtime };

export async function POST(): Promise<Response> {
  const accessGate = await requireEntraAccess('update');
  if (accessGate instanceof Response) {
    return accessGate;
  }

  await Promise.all([
    clearEntraDirectTokenSet(accessGate.tenantId),
    clearEntraCippCredentials(accessGate.tenantId),
  ]);
  await disconnectActiveEntraConnection({
    tenant: accessGate.tenantId,
    userId: accessGate.userId,
  });

  return ok({
    status: 'disconnected',
  });
}
