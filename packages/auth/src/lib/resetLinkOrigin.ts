/**
 * Canonical public-origin resolution for password-reset links.
 *
 * Only trusted server-side configuration may supply the origin, in the same
 * order the rest of the application uses for outbound links
 * (`NEXT_PUBLIC_BASE_URL`, then `NEXTAUTH_URL`, then `HOST`). The repo uses
 * two `HOST` conventions — a full URL (`server/.env.local` sets
 * `HOST=http://localhost:3614`) and a bare hostname (the invitation/invoice
 * sites use `https://${HOST}`) — so `HOST` is parsed as-is first and wrapped
 * with `https://` only when that fails. Request-derived headers (Host, Origin,
 * X-Forwarded-*) are never consulted: an attacker controls those, and a link
 * built from them is a reset-link poisoning vector.
 *
 * Returns null when no trusted origin can be derived so the caller can refuse
 * the send instead of handing a provider a link that begins with "undefined"
 * or points at an attacker-controlled host.
 */

export interface ResetOriginEnv {
  NEXT_PUBLIC_BASE_URL?: string;
  NEXTAUTH_URL?: string;
  HOST?: string;
}

export function resolvePasswordResetOrigin(
  env: ResetOriginEnv | Record<string, string | undefined> = process.env
): string | null {
  for (const candidate of [env.NEXT_PUBLIC_BASE_URL, env.NEXTAUTH_URL]) {
    if (!candidate) continue;
    const origin = normalizeHttpOrigin(candidate);
    if (origin) return origin;
  }

  if (env.HOST) {
    // A HOST that already carries a scheme (http://localhost:3614,
    // https://x.example.com/path/) must be used as-is; blindly wrapping it as
    // `https://${HOST}` parses to a bogus origin whose hostname is "http"
    // (e.g. https://http), which would email a garbage reset link.
    const hostAsIs = normalizeHttpOrigin(env.HOST);
    if (hostAsIs) return hostAsIs;
    // Bare-hostname convention (`psa.example.com`): https://psa.example.com.
    const hostWithScheme = normalizeHttpOrigin(`https://${env.HOST}`);
    if (hostWithScheme) return hostWithScheme;
  }

  return null;
}

function normalizeHttpOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.host) return null;
  // A mis-wrapped scheme yields a bogus origin whose hostname is literally
  // "http" or "https" (e.g. `https://http://...` -> https://http). No real
  // public origin has such a hostname, so treat it as invalid rather than
  // email a garbage reset link.
  if (url.hostname === 'http' || url.hostname === 'https') return null;
  // Normalize to the origin (scheme + host, no path/trailing slash) so a
  // configured base with a path or trailing slash cannot produce a malformed
  // reset path.
  return url.origin;
}
