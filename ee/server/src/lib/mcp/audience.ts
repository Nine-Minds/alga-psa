/**
 * The single predicate for "this IdP audience may be trusted". A trusted agent
 * IdP with no expected `aud` would let any JWT the issuer minted for another
 * app authenticate here, so every layer (write, route, token validation) uses
 * this one check. Callers narrow to `string` through it.
 */
export function isUsableAudience(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Operator-facing message shared by the write side and the token path. */
export const MISSING_AUDIENCE_MESSAGE =
  'An audience is required: the `aud` your IdP issues for this MCP resource.';
