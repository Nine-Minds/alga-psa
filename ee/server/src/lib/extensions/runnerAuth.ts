import crypto from 'crypto';

/**
 * Shared verification for the internal extension-runner host APIs
 * (`/api/internal/ext-*`).
 *
 * These endpoints are reachable without an API key (they are in the middleware
 * skip-list) and are authenticated solely by a shared `x-runner-auth` token.
 * Verification is centralized here so that every host API:
 *   1. compares the token in constant time (no timing side-channel), and
 *   2. refuses to accept a well-known development default in production
 *      (so a deployment that forgot to rotate the secret fails closed instead
 *      of running with a publicly documented token).
 */

export class RunnerAuthError extends Error {
  readonly status = 401;
  constructor(message = 'unauthorized') {
    super(message);
    this.name = 'RunnerAuthError';
  }
}

// Tokens that ship in example/compose files for local development. They must
// never be accepted in production.
const INSECURE_DEFAULT_TOKENS = new Set([
  'local-runner-key',
  'changeme',
  'change-me',
  'secret',
]);

function timingSafeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * Resolve the configured runner token from the supplied env values (in
 * precedence order). Throws if none is set, or if a known-insecure default is
 * configured while running in production.
 */
export function resolveRunnerToken(...candidates: Array<string | undefined | null>): string {
  const expected = candidates.find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
  if (!expected) {
    throw new RunnerAuthError('runner auth token not configured');
  }
  if (process.env.NODE_ENV === 'production' && INSECURE_DEFAULT_TOKENS.has(expected)) {
    throw new RunnerAuthError('runner auth token is set to an insecure default value');
  }
  return expected;
}

/**
 * Assert that the request-provided `x-runner-auth` value matches the configured
 * token, using a constant-time comparison. Throws {@link RunnerAuthError}
 * (status 401) on any mismatch or misconfiguration.
 */
export function assertRunnerAuth(
  provided: string | null | undefined,
  ...candidates: Array<string | undefined | null>
): void {
  const expected = resolveRunnerToken(...candidates);
  if (!provided || !timingSafeEqual(provided, expected)) {
    throw new RunnerAuthError('unauthorized');
  }
}

/**
 * Boolean variant for call sites that need to throw their own error type.
 * Returns false when the token is missing/mismatched, or when the token is
 * unset / left at a known-insecure default in production.
 */
export function isValidRunnerToken(
  provided: string | null | undefined,
  ...candidates: Array<string | undefined | null>
): boolean {
  let expected: string;
  try {
    expected = resolveRunnerToken(...candidates);
  } catch {
    return false;
  }
  return !!provided && timingSafeEqual(provided, expected);
}
