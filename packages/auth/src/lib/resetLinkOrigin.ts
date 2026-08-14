/**
 * Canonical public-origin resolution for password-reset links.
 *
 * Only trusted server-side configuration may supply the origin, in the same
 * order the rest of the application uses for outbound links
 * (`NEXT_PUBLIC_BASE_URL`, then `NEXTAUTH_URL`, then a bare `HOST` hostname).
 * Request-derived headers (Host, Origin, X-Forwarded-*) are never consulted:
 * an attacker controls those, and a link built from them is a reset-link
 * poisoning vector.
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
  const candidates: Array<string | undefined> = [
    env.NEXT_PUBLIC_BASE_URL,
    env.NEXTAUTH_URL,
    env.HOST ? `https://${env.HOST}` : undefined,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const origin = normalizeHttpOrigin(candidate);
    if (origin) return origin;
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
  // Normalize to the origin (scheme + host, no path/trailing slash) so a
  // configured base with a path or trailing slash cannot produce a malformed
  // reset path.
  return url.origin;
}
