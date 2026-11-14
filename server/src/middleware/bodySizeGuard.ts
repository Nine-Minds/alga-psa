/**
 * Refuses, with a 413, a request whose declared body is larger than Next's proxy body cap.
 *
 * Why this exists: next.config.mjs sets `experimental.proxyClientMaxBodySize`, and Next applies it to
 * every request that passes this middleware (see the matcher). Past the cap Next's getCloneableBody
 * (next/dist/server/body-streams.js) logs a warning and ENDS the body stream at the cap, for the
 * middleware's copy and for the copy the route handler / server action then reads. Nothing is
 * thrown: the handler just sees a body cut off at the cap ("Unexpected end of form", a truncated
 * JSON document, a short file). Rejecting on the declared Content-Length, before the body is read,
 * turns that into a named, loud failure.
 *
 * Limits: a request with no Content-Length (chunked transfer) cannot be checked here; the routes
 * that must accept one bound the body themselves (multipartCap answers 411). Server-action bodies
 * past `serverActions.bodySizeLimit` already get Next's own 413 (action-handler.js).
 */
import { NEXT_PROXY_MAX_BODY_BYTES } from '@alga-psa/storage/ingest/bufferedCap';

export const PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE';

/** The declared size when it is over the cap, otherwise null (absent, malformed or within it). */
export function oversizedDeclaredBody(
  headers: { get(name: string): string | null },
  cap: number = NEXT_PROXY_MAX_BODY_BYTES,
): number | null {
  const declared = headers.get('content-length')?.trim();
  if (!declared || !/^\d+$/.test(declared)) return null;
  const bytes = Number(declared);
  return bytes > cap ? bytes : null;
}

/** A 413 in the v1 API error contract, or null when the request may proceed. */
export function bodySizeGuardResponse(
  request: { headers: { get(name: string): string | null } },
  cap: number = NEXT_PROXY_MAX_BODY_BYTES,
): Response | null {
  const bytes = oversizedDeclaredBody(request.headers, cap);
  if (bytes === null) return null;
  const mb = Math.floor(cap / (1024 * 1024));
  return new Response(
    JSON.stringify({
      error: {
        code: PAYLOAD_TOO_LARGE,
        message: `Request body of ${bytes} bytes exceeds the ${mb} MB limit. For larger files use the chunked upload session API (POST /api/documents/uploads).`,
        details: { limit: cap, declared: bytes },
      },
    }),
    { status: 413, headers: { 'content-type': 'application/json' } },
  );
}
