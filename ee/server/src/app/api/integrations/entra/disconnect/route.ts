import { dynamic, ok, runtime } from '../_responses';
import { requireEntraUiFlagEnabled } from '../_guards';
import { clearEntraDirectTokenSet } from '@/lib/integrations/entra/auth/tokenStore';
import { clearEntraCippCredentials } from '@/lib/integrations/entra/providers/cipp/cippSecretStore';
import { disconnectActiveEntraConnection } from '@/lib/integrations/entra/connectionRepository';

export { dynamic, runtime };

export async function POST(): Promise<Response> {
  const flagGate = await requireEntraUiFlagEnabled();
  if (flagGate instanceof Response) {
    return flagGate;
  }

  await Promise.all([
    clearEntraDirectTokenSet(flagGate.tenantId),
    clearEntraCippCredentials(flagGate.tenantId),
  ]);
  await disconnectActiveEntraConnection({
    tenant: flagGate.tenantId,
    userId: flagGate.userId,
  });

  return ok({
    status: 'disconnected',
  });
}
