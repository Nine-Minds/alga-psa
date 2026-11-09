import {
  assertSafeHttpsUrl,
  safeFetch,
  type SafeFetchDeps,
} from '@/lib/net/safeFetch';

const MAX_IDP_DOCUMENT_BYTES = 1024 * 1024;

/** Validate a configured provider URL at registration time; connections validate it again. */
export async function assertSafeIdpUrl(rawUrl: string, deps: SafeFetchDeps = {}): Promise<void> {
  await assertSafeHttpsUrl(rawUrl, deps);
}

/** Fetch provider metadata/JWKS using pinned public addresses and per-hop redirect validation. */
export async function fetchIdpDocument(
  url: string | URL,
  deps: SafeFetchDeps = {},
): Promise<Response> {
  const result = await safeFetch(String(url), { maxBytes: MAX_IDP_DOCUMENT_BYTES }, deps);
  return new Response(new TextDecoder().decode(result.bytes), { status: result.status, headers: result.headers });
}
