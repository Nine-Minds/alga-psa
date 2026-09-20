/**
 * The one place the TypeSafe API key is read and the client is built.
 *
 * Today the key is platform-wide (`TYPESAFE_API_KEY`, read through the same
 * secret chain as `OPENROUTER_API_KEY`). A per-tenant key later means giving
 * `resolveTypeSafeClient` a tenant argument and a lookup; callers do not change.
 */

import { TypeSafeClient } from '@typesafe-ai/sdk';
import { getSecret } from '@alga-psa/core/secrets';

export const TYPESAFE_API_KEY_SECRET = 'TYPESAFE_API_KEY';
export const SMART_SEARCH_AI_FEATURE = 'smart-ticket-search';

let cached: { key: string; client: TypeSafeClient } | null = null;

async function readApiKey(): Promise<string | null> {
  const raw = await getSecret(TYPESAFE_API_KEY_SECRET, TYPESAFE_API_KEY_SECRET, '');
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Returns a client bound to the configured key, or `null` when no key is set.
 * The client is memoized per key value so a rotated secret takes effect on the
 * next call without a restart.
 */
export async function resolveTypeSafeClient(): Promise<TypeSafeClient | null> {
  const key = await readApiKey();
  if (!key) {
    cached = null;
    return null;
  }
  if (cached && cached.key === key) {
    return cached.client;
  }
  const client = new TypeSafeClient({
    apiKey: key,
    // 429/529 are the expected way TypeSafe tells us to slow down; the SDK
    // honors Retry-After. Six retries with a 10s backoff cap outlasts a burst.
    retry: { maxRetries: 6, backoffMaxMs: 10_000 },
    timeout: 20_000,
    defaultHeaders: { 'X-Alga-AI-Feature': SMART_SEARCH_AI_FEATURE },
    logLevel: 'warn',
  });
  cached = { key, client };
  return client;
}

export async function isSmartTicketSearchConfigured(): Promise<boolean> {
  return (await resolveTypeSafeClient()) !== null;
}

/** Test seam: forget the memoized client. */
export function resetTypeSafeClientCache(): void {
  cached = null;
}
