import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { resolveNativeTimeBrowserActor } from '@alga-psa/scheduling/lib/nativeTimeReader';
import { snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from '@alga-psa/co-managed';
import { ApiKeyServiceForApi } from '../../services/apiKeyServiceForApi';

/** An explicitly supplied key selects API authentication, including its own
 * narrowing rules. Invalid or expired keys never fall back to browser cookies.
 * Tenant and credential identity come solely from the validated key record;
 * the artifact consumer rechecks that actual credential under retained locks. */
export async function resolveMeetingArtifactActor(request: NextRequest): Promise<CoManagedAuthenticatedActor | null> {
  if (request.headers.has('x-api-key')) {
    const plaintext = request.headers.get('x-api-key');
    if (!plaintext?.trim()) return null;
    const key = await ApiKeyServiceForApi.validateApiKeyAnyTenant(plaintext);
    if (!key) return null;
    return snapshotCoManagedAuthenticatedActor({ kind: 'api_key', tenant: key.tenant, userId: key.user_id, apiKeyId: key.api_key_id });
  }
  const user = await getCurrentUser().catch(() => null);
  if (!user?.tenant) return null;
  return resolveNativeTimeBrowserActor(user, user.tenant);
}
