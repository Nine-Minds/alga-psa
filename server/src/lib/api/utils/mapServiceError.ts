import { NextResponse } from 'next/server';

/**
 * Errors thrown across the `@product/mcp/entry` dynamic-import seam lose class
 * identity, so they are matched structurally (by `name` / `code` / `statusCode`),
 * never with `instanceof`.
 */
const KNOWN_ERRORS: Record<string, { status: number; code?: string }> = {
  AgentBindingConflictError: { status: 409 },
  TierAccessError: { status: 403, code: 'TIER_ACCESS_DENIED' },
};

/**
 * Map a thrown service-layer error to a JSON 4xx response, or return null when the
 * error is not recognised (callers rethrow, preserving 500 behaviour).
 *
 * Service-principal limit/service errors carry their own `code`/`statusCode` and are
 * handled by the generic rule (no edition-specific names live in CE).
 *
 * Recognised: well-known names above (their own `statusCode`/`code` win when present),
 * and any Error with a string `code` and a numeric 4xx `statusCode`.
 */
export function mapServiceErrorToResponse(e: unknown): NextResponse | null {
  if (!(e instanceof Error)) return null;
  const err = e as Error & { code?: unknown; statusCode?: unknown };
  const known = KNOWN_ERRORS[err.name];
  const ownStatus =
    typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : undefined;
  const ownCode = typeof err.code === 'string' ? err.code : undefined;

  const status = ownStatus ?? (known?.status);
  if (status === undefined) return null;
  if (!known && ownCode === undefined) return null;

  const code = ownCode ?? known?.code;
  return NextResponse.json(code ? { error: err.message, code } : { error: err.message }, { status });
}

/** Run a handler body, converting recognised service errors to 4xx responses. */
export async function withServiceErrorMapping(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    const mapped = mapServiceErrorToResponse(e);
    if (mapped) return mapped;
    throw e;
  }
}
